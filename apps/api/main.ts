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
  buildAnalytics,
  LoggingCheckStore,
  mediaInputError,
  MemoryCheckStore,
  MemoryCorpusStore,
  MOCK_SCENARIO_DESCRIPTIONS,
  mockResponse,
  INDICATORS,
  publicCatalog,
  runCheck,
} from "@prawdowid/core";

const config = loadConfig({ get: (k) => Deno.env.get(k) });
// Every saved check also becomes one JSON audit line in the host's log (no question text), so the
// MVP check log survives restarts and instances until Supabase lands (decision 001).
const store = new LoggingCheckStore(new MemoryCheckStore());
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? "";
const corpus = new MemoryCorpusStore();
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

// ── Rate limit: fixed window, in memory (per instance) ──────────────────────
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, { n: number; start: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(key, { n: 1, start: now });
    return false;
  }
  h.n++;
  return h.n > MAX_PER_WINDOW;
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
  });
});

app.get("/api/v1/schema", (c) => c.json(contractJsonSchema()));

// Open source catalog: the only publishers whose material can become evidence, and the statistics
// we look up. Additive to contract v1 (decision 006).
app.get("/api/v1/sources", (c) =>
  c.json({
    contract_version: CONTRACT_VERSION,
    policy: "Dowodem może być tylko materiał z tej listy. Nie przeszukujemy otwartej sieci.",
    sources: publicCatalog(config.trustedSources),
    statistics: INDICATORS.map((i) => ({
      key: i.key,
      label: i.label_pl,
      unit: i.unit,
      definition: i.definition,
      sources: [i.eurostat && "eurostat", i.nbp && "nbp", i.gus_var && "gus"].filter(Boolean),
    })),
  }));

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
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      (c.env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname ?? "local";
    const endUser = c.req.header("x-end-user");
    const limitKey = client && endUser ? `${client}:${await sha256(endUser)}` : `ip:${ip}`;
    if (rateLimited(limitKey)) {
      return c.json(systemOnly("rate_limited", "Zbyt wiele zapytań", "Spróbuj ponownie za chwilę."), 429);
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
    return c.json(await runCheck({ ...body, channel }, { config, store, corpus, resolveHost }));
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
  if (!(await sameSecret(c.req.header("authorization") ?? "", `Bearer ${ADMIN_TOKEN}`))) {
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
