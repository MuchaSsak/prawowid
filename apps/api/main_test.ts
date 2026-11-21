// HTTP-level tests through app.fetch: no server, no network, no keys. Env is set before importing.
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { CheckResponseSchema, MOCK_SCENARIOS } from "@prawdowid/core";

Deno.env.set("MOCK_DELAY_MS", "0");
Deno.env.set("CLIENT_KEYS", "bot:test-bot-key");
Deno.env.set("WEB_ORIGINS", "https://web.example");
Deno.env.delete("OPENROUTER_API_KEY");
Deno.env.delete("GOOGLE_FACT_CHECK_API_KEY");
Deno.env.delete("PRAWDOWID_MODE");
const { app } = await import("./main.ts");

let ipCounter = 0;
/** Each call gets its own client IP unless one is given, so rate limits don't leak between tests. */
function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return app.fetch(new Request("http://x/api/v1/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${++ipCounter}`, ...headers },
    body: raw ?? JSON.stringify(body),
  }));
}
const get = (path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`http://x${path}`, { headers }));
const valid = (r: unknown) => {
  const p = CheckResponseSchema.safeParse(r);
  if (!p.success) throw new Error(p.error.message);
};

Deno.test("GET / and /api/v1/health: contract version, mode, booleans only", async () => {
  const root = await (await get("/")).json();
  assertEquals(root.contract_version, "1.0");
  const h = await (await get("/api/v1/health")).json();
  assertEquals(h.mode, "live");
  assertEquals(h.configured, { openrouter: false, google_fact_check: false });
  assert(!JSON.stringify(h).includes("key-"), "health must never expose secret values");
});

Deno.test("GET /api/v1/schema: request + response JSON Schema", async () => {
  const s = await (await get("/api/v1/schema")).json();
  assertEquals(s.contract_version, "1.0");
  assert(s.request.properties.input);
  for (const k of ["status", "claims", "meta", "escalation", "warnings"]) assert(s.response.properties[k], k);
});

Deno.test("GET /api/v1/sources: the open allowlist with access and terms per source, plus the statistics catalog", async () => {
  const res = await get("/api/v1/sources");
  assertEquals(res.status, 200);
  const s = await res.json();
  const ids = s.sources.map((x: { id: string }) => x.id);
  for (const id of ["reuters", "ap", "pap", "sprawdzam_to", "demagog", "eurostat", "nbp", "gus"]) assert(ids.includes(id), id);
  for (const x of s.sources) assert(x.access && x.terms && x.tier, x.id);
  assert(s.statistics.some((x: { key: string }) => x.key === "unemployment_rate"));
});

Deno.test("GET /api/v1/mock/scenarios lists every scenario", async () => {
  const s = await (await get("/api/v1/mock/scenarios")).json();
  assertEquals(Object.keys(s.scenarios).sort(), [...MOCK_SCENARIOS].sort());
});

for (const scenario of MOCK_SCENARIOS) {
  Deno.test(`POST mock "${scenario}" over HTTP → 200, valid v1, marked demo`, async () => {
    const res = await post({ input: { type: "text", value: "cokolwiek" }, mock: scenario });
    assertEquals(res.status, 200);
    const r = await res.json();
    valid(r);
    assertEquals(r.meta.mode, "mock");
    assertEquals(r.warnings[0].type, "demo_data");
  });
}

Deno.test("mock via demo:<scenario> text works without the mock field only when mock mode is requested", async () => {
  const r = await (await post({ input: { type: "text", value: "demo:escalation" }, mock: true })).json();
  assertEquals(r.escalation.state, "recommended");
});

Deno.test("live mode without keys → technical_error naming the missing key, never a verdict (J)", async () => {
  const r = await (await post({ input: { type: "text", value: "Polska ma 38 milionów mieszkańców." } })).json();
  valid(r);
  assertEquals(r.status, "technical_error");
  assertEquals(r.claims.length, 0);
  assert(r.system_message.text.includes("OPENROUTER_API_KEY"));
  assertEquals(r.meta.mode, "live");
});

Deno.test("malformed JSON → 400 input_rejected", async () => {
  const res = await post(null, {}, "{not json");
  assertEquals(res.status, 400);
  assertEquals((await res.json()).status, "input_rejected");
});

Deno.test("missing input / wrong value type → 400 input_rejected", async () => {
  for (const body of [{}, { input: { type: "text" } }, { input: { type: "text", value: 5 } }]) {
    const res = await post(body);
    assertEquals(res.status, 400);
    valid(await res.json());
  }
});

Deno.test("empty text → input_rejected (live and mock)", async () => {
  assertEquals((await (await post({ input: { type: "text", value: "  " } })).json()).status, "input_rejected");
  assertEquals((await (await post({ input: { type: "text", value: "  " }, mock: true })).json()).status, "input_rejected");
});

Deno.test("video and audio: mock answers with timestamped claims; live says not yet supported (no verdict)", async () => {
  const mp4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";
  const ogg = "data:audio/webm;codecs=opus;base64,GkXfo59ChoEB";
  const v = await (await post({ input: { type: "video", value: mp4 }, user_message: "Czy to prawda?", mock: true })).json();
  valid(v);
  assertEquals([v.input.type, v.status, v.meta.mode], ["video", "ok", "mock"]);
  assert(v.claims.every((c: { provenance: string }) => c.provenance.startsWith("video@")));
  const a = await (await post({ input: { type: "audio", value: ogg }, mock: true })).json();
  valid(a);
  assertEquals(a.input.type, "audio");
  for (const value of [mp4, ogg]) {
    const type = value.startsWith("data:video") ? "video" : "audio";
    const live = await (await post({ input: { type, value } })).json();
    valid(live);
    assertEquals([live.status, live.claims.length], ["input_rejected", 0]);
  }
});

Deno.test("media checks run in mock mode too: wrong format, mismatched type, not a data URL", async () => {
  for (const input of [
    { type: "video", value: "data:video/x-flv;base64,AAAA" },
    { type: "audio", value: "data:video/mp4;base64,AAAA" },
    { type: "image", value: "https://example.com/a.png" },
  ]) {
    const r = await (await post({ input, mock: true })).json();
    valid(r);
    assertEquals(r.status, "input_rejected", JSON.stringify(input));
  }
});

Deno.test("SSRF through the API: private and local URLs are refused", async () => {
  for (const value of ["http://localhost:8787/api/v1/health", "http://169.254.169.254/latest", "http://10.0.0.1/", "file:///etc/passwd"]) {
    const r = await (await post({ input: { type: "url", value } })).json();
    assertEquals(r.status, "input_rejected", value);
  }
});

Deno.test("body over 8 MB → 413 input_rejected", async () => {
  const big = "a".repeat(8 * 1024 * 1024 + 10);
  const res = await post(null, { "content-length": String(big.length + 40) }, JSON.stringify({ input: { type: "text", value: big } }));
  assertEquals(res.status, 413);
  assertEquals((await res.json()).status, "input_rejected");
});

Deno.test("rate limit: the 13th request in a minute from one IP → 429 rate_limited", async () => {
  const h = { "x-forwarded-for": "10.200.0.1" };
  for (let i = 0; i < 12; i++) assertEquals((await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, h)).status, 200);
  const res = await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, h);
  assertEquals(res.status, 429);
  assertEquals((await res.json()).status, "rate_limited");
});

Deno.test("keyed bot client: limits are per end user, not per bot IP", async () => {
  const ip = { "x-forwarded-for": "10.201.0.1", "x-client-key": "test-bot-key" };
  for (let i = 0; i < 12; i++) await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, { ...ip, "x-end-user": "user-A" });
  assertEquals((await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, { ...ip, "x-end-user": "user-A" })).status, 429);
  assertEquals((await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, { ...ip, "x-end-user": "user-B" })).status, 200);
});

Deno.test("a wrong client key does not get per-user limits (falls back to the IP)", async () => {
  const h = { "x-forwarded-for": "10.202.0.1", "x-client-key": "wrong" };
  for (let i = 0; i < 12; i++) await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, { ...h, "x-end-user": `u${i}` });
  assertEquals((await post({ input: { type: "text", value: "x" }, mock: "confirmed" }, { ...h, "x-end-user": "u99" })).status, 429);
});

Deno.test("CORS: allowed origin echoed, unknown origin not allowed, bot headers allowed", async () => {
  const pre = (origin: string) =>
    app.fetch(new Request("http://x/api/v1/check", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-client-key" },
    }));
  const ok = await pre("https://web.example");
  assertEquals(ok.headers.get("access-control-allow-origin"), "https://web.example");
  assert((ok.headers.get("access-control-allow-headers") ?? "").toLowerCase().includes("x-client-key"));
  const bad = await pre("https://evil.example");
  assert(bad.headers.get("access-control-allow-origin") !== "https://evil.example");
});

Deno.test("DELETE /api/v1/session/:id", async () => {
  const res = await app.fetch(new Request("http://x/api/v1/session/abc", { method: "DELETE" }));
  assertEquals(await res.json(), { deleted: true, checks: 0 });
});

Deno.test("unknown and old unversioned routes → 404 JSON", async () => {
  assertEquals((await app.fetch(new Request("http://x/api/check", { method: "POST" }))).status, 404);
  const r = await get("/nope");
  assertEquals(r.status, 404);
  assertEquals((await r.json()).error, "not found");
});
