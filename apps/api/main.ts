/**
 * Prawdowid API (Deno + Hono). A thin channel adapter over @prawdowid/core: every channel (web
 * now, a messaging bot later) calls the same runCheck (hard constraint 18).
 *
 *   POST   /api/check            { input: { type: "text"|"url"|"image", value }, user_message?, session_id? }
 *   GET    /api/health           which secrets/routes are configured (booleans only, never values)
 *   DELETE /api/session/:id      deletes a session's logs and cached results
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import {
  type CheckRequest,
  type CheckResponse,
  CONTRACT_VERSION,
  isPrivateIp,
  loadConfig,
  MemoryCheckStore,
  MemoryCorpusStore,
  runCheck,
} from "@prawdowid/core";

const config = loadConfig({ get: (k) => Deno.env.get(k) });
const store = new MemoryCheckStore();
const corpus = new MemoryCorpusStore();
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const ALLOWED_ORIGINS = (Deno.env.get("WEB_ORIGINS") ?? "http://localhost:4321,http://127.0.0.1:4321")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function resolveHost(hostname: string): Promise<string[]> {
  const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(hostname, "A"), Deno.resolveDns(hostname, "AAAA")]);
  const ips = [
    ...(a.status === "fulfilled" ? a.value : []),
    ...(aaaa.status === "fulfilled" ? aaaa.value : []),
  ];
  if (ips.length === 0) throw new Error("no DNS records");
  return ips;
}

// ── Rate limit: fixed window per client, in memory (good enough for one instance) ──
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

const app = new Hono();

app.use("/api/*", cors({ origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null), allowMethods: ["GET", "POST", "DELETE"] }));

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    configured: {
      openrouter: Boolean(config.secrets.openrouterApiKey),
      google_fact_check: Boolean(config.secrets.googleFactCheckApiKey),
    },
    models: config.models,
    storage: "memory (mock, lost on restart)",
  }));

app.post(
  "/api/check",
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json(rejected("Plik jest za duży (maks. 5 MB obrazu).")),
  }),
  async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      (c.env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname ?? "local";
    if (rateLimited(ip)) {
      return c.json(systemOnly("rate_limited", "Zbyt wiele zapytań", "Spróbuj ponownie za chwilę."), 429);
    }
    let body: CheckRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rejected("Nieprawidłowe zapytanie (oczekujemy JSON)."), 400);
    }
    const result = await runCheck({ ...body, channel: "web" }, {
      config,
      store,
      corpus,
      resolveHost,
    });
    return c.json(result);
  },
);

app.delete("/api/session/:id", async (c) => {
  const id = c.req.param("id");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`session:${id}`));
  const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await store.deleteSession(hash);
  return c.json({ deleted: true, checks: res.checks });
});

app.notFound((c) => c.json({ error: "not found" }, 404));

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
    meta: { latency_ms: 0, stages_ms: {}, models: [], prompt_versions: [], cost_usd: 0, cached: false, mode: "live" },
  };
}
function rejected(text: string) {
  return systemOnly("input_rejected", "Nie możemy przyjąć tych danych", text);
}

// Retention for the mock store (decisions/001: 30 days).
setInterval(() => store.prune(new Date()), 3600_000);

// Exported for tests; served when run directly.
export { app, isPrivateIp };
if (import.meta.main) {
  console.log(
    `Prawdowid API on http://localhost:${PORT}  (openrouter: ${config.secrets.openrouterApiKey ? "yes" : "NO"}, google fact check: ${
      config.secrets.googleFactCheckApiKey ? "yes" : "NO"
    })`,
  );
  Deno.serve({ port: PORT }, (req, info) => app.fetch(req, { remoteAddr: info.remoteAddr }));
}
