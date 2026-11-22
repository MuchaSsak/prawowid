/**
 * Prawdomat API (Deno + Hono). A thin channel adapter over @prawdowid/core: every channel (web
 * now, a messaging bot next) calls the same runCheck (hard constraint 18).
 * Full reference: .agents/project-info/architecture/api-reference.md
 *
 *   GET    /                         service info (JSON)
 *   GET    /api/v1/health            mode + which secrets are configured (booleans only)
 *   POST   /api/v1/check             run a check (live or mock), returns CheckResponse
 *   GET    /api/v1/schema            JSON Schema of the request and response (contract v1)
 *   GET    /api/v1/mock/scenarios    mock scenario names and what each returns
 *   DELETE /api/v1/session/:id       delete a session's logs and cached results
 *   GET    /api/v1/admin/checks      recent check log rows (masked question, time, sources, verdicts);
 *                                    needs Authorization: Bearer <ADMIN_TOKEN>, 404 when no token is set
 *   GET    /api/v1/admin/analytics   ?range=24h|7d|30d|90d|1y aggregates for the admin page (same token)
 *   GET    /api/v1/admin/sources     every switchable evidence source and its on/off state (same token)
 *   POST   /api/v1/admin/sources     { key, enabled } switches one source on or off, no deploy (same token)
 *   GET    /api/v1/admin/sources/search?q=  what the enabled corpus finds for a phrase, no LLM (same token)
 *
 * Env (all optional except the LLM key in live mode):
 *   OPENROUTER_API_KEY, GOOGLE_FACT_CHECK_API_KEY   secrets (live mode)
 *   PRAWDOWID_MODE=live|mock                        mock = every check returns fixtures (default live)
 *   MOCK_DELAY_MS=600                               simulated latency in mock mode
 *   CLIENT_KEYS=bot:<secret>,...                    server-to-server clients (messaging bot)
 *   MOCK_CLIENTS=bot,...                            these client names always get mock answers, even in live
 *                                                   mode (holds the bot in mock until its spend caps exist)
 *   WEB_ORIGINS=https://…,…                         browser origins allowed by CORS
 *   ADMIN_TOKEN=<secret>                            enables GET /api/v1/admin/checks (the check log)
 */
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import {
  type CheckRequest,
  type CheckResponse,
  CONTRACT_VERSION,
  contractJsonSchema,
  isMediaType,
  loadConfig,
  type AnalyticsRange,
  ANALYTICS_RANGES,
  applySourceControls,
  collectionOf,
  listSources,
  buildAnalytics,
  LoggingCheckStore,
  mediaInputError,
  MemoryCheckStore,
  MemoryCorpusStore,
  MOCK_SCENARIO_DESCRIPTIONS,
  mockResponse,
  CONNECTORS,
  INDICATORS,
  IndexedCorpusStore,
  NARRATIVE_MATCHERS,
  publicCatalog,
  runCheck,
} from "@prawdowid/core";
import { type Decision, ipKey, RateLimiter, waitText } from "./rate-limit.ts";
import { openSourceControlStore } from "./source-controls.ts";

const config = loadConfig({ get: (k) => Deno.env.get(k) });
// Every saved check also becomes one JSON audit line in the host's log (no question text), so the
// MVP check log survives restarts and instances until Supabase lands (decision 001).
const store = new LoggingCheckStore(new MemoryCheckStore());
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";
const corpus = new IndexedCorpusStore();
await corpus.loadIndex(new URL("../../data/corpus/alert-corpus-index.json", import.meta.url));
/** Operator on/off switches for evidence sources (admin page /admin/zrodla). */
const sourceControls = await openSourceControlStore();
/** Routes, corpus and allowlist with the switched-off sources removed, read once per request. */
/** Reads the switches; a store that hangs must not hang every check (fail closed after 2 s). */
async function readControls() {
  let timer: number | undefined;
  try {
    return await Promise.race([
      sourceControls.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("source controls read timeout")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function liveSources() {
  const state = await readControls();
  return {
    state,
    ...applySourceControls({ connectors: CONNECTORS, corpus, trustedSources: config.trustedSources }, state.disabled),
  };
}
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const MODE: "live" | "mock" = Deno.env.get("PRAWDOWID_MODE") === "mock" ? "mock" : "live";
const MOCK_DELAY_MS = Number(Deno.env.get("MOCK_DELAY_MS") ?? 600);
const ALLOWED_ORIGINS = (Deno.env.get("WEB_ORIGINS") ?? "http://localhost:4321,http://127.0.0.1:4321")
  .split(",").map((s) => s.trim()).filter(Boolean);
/** name → key; a client sends `X-Client-Key: <key>` and gets per-end-user rate limits. */
const CLIENT_KEYS = new Map(
  (Deno.env.get("CLIENT_KEYS") ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    return [p.slice(i + 1), p.slice(0, i)] as [string, string];
  }),
);

/** Client names (from CLIENT_KEYS) held in mock mode while the web goes live (messaging-bot.md). */
const MOCK_CLIENTS = new Set((Deno.env.get("MOCK_CLIENTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

async function resolveHost(hostname: string): Promise<string[]> {
  const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(hostname, "A"), Deno.resolveDns(hostname, "AAAA")]);
  const ips = [...(a.status === "fulfilled" ? a.value : []), ...(aaaa.status === "fulfilled" ? aaaa.value : [])];
  if (ips.length === 0) throw new Error("no DNS records");
  return ips;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Rate limits: in memory, per instance (rate-limit.ts; numbers in api-reference.md) ──
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Every POST /check (mock included) per IP, or per end user of a keyed client. Loose for people, tight for scripts. */
const perCaller = new RateLimiter({
  burst: { capacity: 12, refillMs: 5_000 },
  windows: [{ limit: 150, windowMs: HOUR }, { limit: 600, windowMs: DAY }],
  abuse: { strikes: 30, windowMs: 10 * MIN, banMs: 15 * MIN, maxBanMs: DAY },
});
/** Live checks only (they cost money), across all callers: caps the spend even against many IPs. */
const liveBudget = new RateLimiter({ windows: [{ limit: 600, windowMs: HOUR }, { limit: 4_000, windowMs: DAY }] });
/** Live checks per keyed client (e.g. the bot), so one client can't use up the whole budget. */
const perClientLive = new RateLimiter({ windows: [{ limit: 1_500, windowMs: DAY }] });
/** Failed admin logins per IP: stops guessing ADMIN_TOKEN. */
const adminFailures = new RateLimiter({
  windows: [{ limit: 10, windowMs: 15 * MIN }],
  abuse: { strikes: 20, windowMs: 15 * MIN, banMs: HOUR, maxBanMs: DAY },
});
setInterval(() => [perCaller, liveBudget, perClientLive, adminFailures].forEach((l) => l.sweep()), 10 * MIN);

/**
 * The caller's IP. The socket address wins: X-Forwarded-For is set by the caller and would let a
 * script pick a new "IP" per request. The header is only used when there is no socket address
 * (in-process tests, or a host that gives none).
 */
function clientIp(c: Context): string {
  const socket = (c.env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname;
  return socket ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function limitedResponse(c: Context, d: Exclude<Decision, { ok: true }>, title: string, text: string) {
  c.header("Retry-After", String(Math.ceil(d.retryAfterMs / 1000)));
  return c.json(systemOnly("rate_limited", title, `${text} Spróbuj ponownie za ${waitText(d.retryAfterMs)}.`), 429);
}

function systemOnly(status: CheckResponse["status"], title: string, text: string): CheckResponse {
  return {
    contract_version: CONTRACT_VERSION,
    check_id: crypto.randomUUID(),
    status,
    answer_language: "pl",
    system_message: { title, text },
    summary: { fact_claims: 0, opinions: 0, text: "" },
    claims: [],
    warnings: [],
    limitations: [],
    escalation: { state: "none", reason: null },
    input: { type: "text", title: null, url: null, published_at: null, description: null },
    meta: { latency_ms: 0, stages_ms: {}, models: [], prompt_versions: [], cost_usd: 0, cached: false, mode: MODE },
  };
}
const rejected = (text: string) => systemOnly("input_rejected", "Nie możemy przyjąć tych danych", text);

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null),
    allowMethods: ["GET", "POST", "DELETE"],
    // Authorization: the admin page sends ADMIN_TOKEN; origins stay limited to WEB_ORIGINS.
    allowHeaders: ["Content-Type", "X-Client-Key", "X-End-User", "Authorization"],
  }),
);

app.get("/", (c) =>
  c.json({
    service: "Prawdomat API",
    contract_version: CONTRACT_VERSION,
    mode: MODE,
    docs: "GET /api/v1/schema, GET /api/v1/sources, GET /api/v1/mock/scenarios, POST /api/v1/check",
  }));

app.get("/api/v1/health", (c) => {
  // A keyed client also learns its own effective mode (MOCK_CLIENTS can hold it in mock).
  const client = CLIENT_KEYS.get(c.req.header("x-client-key") ?? "");
  return c.json({
    ok: true,
    contract_version: CONTRACT_VERSION,
    mode: MODE,
    ...(client ? { client_mode: MODE === "mock" || MOCK_CLIENTS.has(client) ? "mock" : "live" } : {}),
    configured: {
      openrouter: Boolean(config.secrets.openrouterApiKey),
      google_fact_check: Boolean(config.secrets.googleFactCheckApiKey),
    },
    models: config.models,
    storage: "memory (mock, lost on restart)",
    corpus: corpus.indexStatus(),
    source_controls: sourceControls.persistence,
  });
});

app.get("/api/v1/schema", (c) => c.json(contractJsonSchema()));

// Open source catalog: the only publishers whose material can become evidence, and the statistics
// we look up. Additive to contract v1 (decision 006).
app.get("/api/v1/sources", async (c) => {
  // Switched-off publishers and routes disappear from the open list too (source controls).
  const live = await liveSources().catch(() => null);
  // Never list a switched-off source as usable just because the switches could not be read.
  if (!live) return c.json({ error: "source list temporarily unavailable, try again" }, 503);
  const off = new Set(live.state.disabled);
  return c.json({
    contract_version: CONTRACT_VERSION,
    policy: "Dowodem może być tylko materiał z tej listy. Nie przeszukujemy otwartej sieci.",
    sources: publicCatalog(live.trustedSources),
    // The routes this deployment runs (architecture/extensibility.md); context routes never decide a verdict.
    routes: CONNECTORS.filter((r) => !off.has(`route:${r.id}`)).map((r) => ({ id: r.id, label: r.label, required: r.required })),
    context_routes: NARRATIVE_MATCHERS.map((m) => ({ id: m.id, label: m.label, catalog: m.catalog })),
    statistics: INDICATORS.map((i) => ({
      key: i.key,
      label: i.label_pl,
      unit: i.unit,
      definition: i.definition,
      sources: [i.eurostat && "eurostat", i.nbp && "nbp", i.gus_var && "gus"].filter(Boolean),
    })),
  });
});

app.get("/api/v1/mock/scenarios", (c) =>
  c.json({
    how_to_pick: [
      'request field "mock": "<scenario>" (or true = picked from the input)',
      'text input starting with "demo:<scenario>" (works from a chat app)',
      "PRAWDOWID_MODE=mock on the server makes every check a mock",
    ],
    scenarios: MOCK_SCENARIO_DESCRIPTIONS,
  }));

app.post(
  "/api/v1/check",
  bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json(rejected("Plik jest za duży (maks. 5 MB)."), 413) }),
  async (c) => {
    // Clients with a key (the messaging bot) are limited per end user, browsers per IP.
    const client = CLIENT_KEYS.get(c.req.header("x-client-key") ?? "");
    const endUser = c.req.header("x-end-user");
    const limitKey = client && endUser ? `${client}:${await sha256(endUser)}` : ipKey(clientIp(c));
    const caller = perCaller.hit(limitKey);
    if (!caller.ok) {
      return limitedResponse(
        c,
        caller,
        "Zbyt wiele zapytań",
        caller.reason === "banned" ? "Za dużo zapytań w krótkim czasie." : "Wysyłasz pytania szybciej, niż je sprawdzamy.",
      );
    }

    let body: CheckRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rejected("Nieprawidłowe zapytanie (oczekujemy JSON)."), 400);
    }
    if (!body || typeof body !== "object" || !body.input || typeof body.input.value !== "string") {
      return c.json(rejected('Brak pola "input": { "type": "text"|"url"|"image"|"video"|"audio", "value": "…" }.'), 400);
    }
    const channel = body.channel ?? (client ? "messaging" : "web");

    const wantsMock = MODE === "mock" || (client !== undefined && MOCK_CLIENTS.has(client)) || body.mock === true ||
      (typeof body.mock === "string" && body.mock !== "");
    if (wantsMock) {
      // Same input checks as live, so a channel built on mock gets the same rejections later.
      const bad = !body.input.value.trim()
        ? "Wklej tekst, link albo dodaj obraz, wideo lub nagranie audio."
        : isMediaType(body.input.type)
        ? mediaInputError(body.input.type, body.input.value)
        : null;
      if (bad) {
        const r = rejected(bad);
        r.meta.mode = "mock";
        return c.json(r);
      }
      if (MOCK_DELAY_MS > 0) await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
      const res = mockResponse({ ...body, channel });
      res.meta.latency_ms = MOCK_DELAY_MS;
      return c.json(res);
    }
    // Live checks cost money: a per-client and a service-wide cap (mock traffic never counts).
    const budget = (client ? perClientLive.check(`client:${client}`) : { ok: true as const });
    const total = budget.ok ? liveBudget.hit("all") : budget;
    if (!total.ok) {
      return limitedResponse(c, total, "Chwilowo nie przyjmujemy nowych sprawdzeń", "Osiągnęliśmy limit sprawdzeń usługi.");
    }
    if (client) perClientLive.hit(`client:${client}`);
    // Pin the source switches for this whole check. If they can't be read, fail closed: answering
    // with every source on could cite one an operator switched off.
    let live: Awaited<ReturnType<typeof liveSources>>;
    try {
      live = await liveSources();
    } catch {
      return c.json(systemOnly("technical_error", "Chwilowy problem z usługą", "Nie mogliśmy wczytać listy źródeł. Spróbuj ponownie za chwilę."), 503);
    }
    return c.json(
      await runCheck({ ...body, channel }, {
        config: { ...config, trustedSources: live.trustedSources },
        store,
        corpus: live.corpus,
        connectors: live.connectors,
        resolveHost,
        cacheScope: live.state.revision ? `sources:${live.state.revision}` : undefined,
      }),
    );
  },
);

/** Constant-time comparison of two strings via their digests (no early exit on the first difference). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Admin routes: 404 when ADMIN_TOKEN is unset, 401 on a wrong token (constant-time compare). */
async function adminDenied(c: Context): Promise<Response | null> {
  if (!ADMIN_TOKEN) return c.json({ error: "not found", see: "GET /" }, 404);
  const key = ipKey(clientIp(c));
  const blocked = adminFailures.check(key);
  if (!blocked.ok) {
    c.header("Retry-After", String(Math.ceil(blocked.retryAfterMs / 1000)));
    return c.json({ error: "too many failed attempts" }, 429);
  }
  if (!(await sameSecret(c.req.header("authorization") ?? "", `Bearer ${ADMIN_TOKEN}`))) {
    adminFailures.hit(key);
    return c.json({ error: "unauthorized" }, 401);
  }
  return null;
}

// The check log for the team (MVP: question, time, sources, result).
app.get("/api/v1/admin/checks", async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
  return c.json({
    note: "Masked questions, newest first. This instance's memory only (30-day retention); every check is also an audit line in the host log (event prawdowid.check).",
    checks: await store.listRecent(limit),
  });
});

// Aggregates for the admin analytics page (decision 011). Browser-callable from WEB_ORIGINS with the
// admin token; returns counts plus the masked text of the most repeated claims, nothing per person.
app.get("/api/v1/admin/analytics", async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const range = c.req.query("range") ?? "7d";
  if (!(ANALYTICS_RANGES as readonly string[]).includes(range)) {
    return c.json({ error: `range must be one of ${ANALYTICS_RANGES.join(", ")}` }, 400);
  }
  const now = new Date();
  const span = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range as AnalyticsRange] * 86_400_000;
  const { checks, events } = await store.listSince(new Date(now.getTime() - 2 * span));
  return c.json(buildAnalytics(checks, events, { range: range as AnalyticsRange, now }));
});

// Source controls (admin page /admin/zrodla): switch evidence sources off and on without a deploy.
async function sourcesReport() {
  const state = await readControls();
  return {
    persistence: sourceControls.persistence,
    revision: state.revision,
    updated_at: state.updated_at,
    sources: listSources(
      { connectors: CONNECTORS, collections: corpus.collections(), trustedSources: config.trustedSources },
      state.disabled,
    ),
    audit: state.audit,
  };
}

app.get("/api/v1/admin/sources", async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  return c.json(await sourcesReport());
});

app.post("/api/v1/admin/sources", async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const body = await c.req.json().catch(() => null) as { key?: unknown; enabled?: unknown } | null;
  if (!body || typeof body.key !== "string" || typeof body.enabled !== "boolean") {
    return c.json({ error: 'expected { "key": "<kind>:<id>", "enabled": true|false }' }, 400);
  }
  const report = await sourcesReport();
  // A switched-off key whose source has since gone (e.g. a rebuilt corpus) can still be switched back on.
  const known = report.sources.some((s) => s.key === body.key) ||
    (body.enabled && (await readControls()).disabled.includes(body.key));
  if (!known) return c.json({ error: `unknown source key: ${body.key.slice(0, 80)}` }, 400);
  await sourceControls.set(body.key, body.enabled);
  return c.json(await sourcesReport());
});

app.get("/api/v1/admin/sources/search", async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const q = (c.req.query("q") ?? "").trim().slice(0, 300);
  if (!q) return c.json({ error: "q is required" }, 400);
  const live = await liveSources();
  const t0 = performance.now();
  // Same view a check uses: switched-off collections, publishers or the whole corpus route find nothing.
  const hits = await live.corpus.search([q], 10);
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  return c.json({
    ms,
    hits: hits.map((r) => ({
      title: r.title,
      publisher: r.publisher,
      url: r.url,
      published_at: r.published_at,
      collection: collectionOf(r) ?? r.route,
      excerpt: r.text.length > 280 ? `${r.text.slice(0, 279)}…` : r.text,
    })),
  });
});

app.delete("/api/v1/session/:id", async (c) => {
  const res = await store.deleteSession(await sha256(`session:${c.req.param("id")}`));
  return c.json({ deleted: true, checks: res.checks });
});

app.notFound((c) => c.json({ error: "not found", see: "GET /" }, 404));

// Retention for the mock store (decisions/001: 30 days).
setInterval(() => store.prune(new Date()), 3600_000);

export { app };
if (import.meta.main) {
  console.log(
    `Prawdomat API on http://localhost:${PORT}  mode=${MODE}  openrouter=${config.secrets.openrouterApiKey ? "yes" : "NO"}  google_fact_check=${
      config.secrets.googleFactCheckApiKey ? "yes" : "NO"
    }`,
  );
  Deno.serve({ port: PORT }, (req, info) => app.fetch(req, { remoteAddr: info.remoteAddr }));
}
