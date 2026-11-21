// The v1 contract: mock fixtures and live-pipeline outputs must both match the same schema.
import { assert, assertEquals } from "jsr:@std/assert@^1";
import {
  CheckResponseSchema,
  loadConfig,
  MemoryCheckStore,
  MemoryCorpusStore,
  MOCK_SCENARIOS,
  mockResponse,
  pickScenario,
  runCheck,
} from "../src/mod.ts";

function valid(r: unknown) {
  const p = CheckResponseSchema.safeParse(r);
  if (!p.success) throw new Error(p.error.message);
}

for (const s of MOCK_SCENARIOS) {
  Deno.test(`mock scenario "${s}" matches the v1 schema and is marked as demo`, () => {
    const r = mockResponse({ input: { type: "text", value: "x" } }, s);
    valid(r);
    assertEquals(r.meta.mode, "mock");
    assertEquals(r.warnings[0].type, "demo_data");
    for (const c of r.claims) {
      for (const cit of c.citations) assert(cit.url.startsWith("https://example.org/"), "mock sources must be example.org");
    }
    const verdictStatuses = ["ok", "partial"];
    if (!verdictStatuses.includes(r.status)) assertEquals(r.claims.length, 0);
    else assert(r.claims.length > 0);
  });
}

Deno.test("mock scenario selection: explicit name, demo: prefix, input type, deterministic hash", () => {
  assertEquals(pickScenario({ input: { type: "text", value: "abc" }, mock: "conflict" }), "conflict");
  assertEquals(pickScenario({ input: { type: "text", value: "demo:partial cokolwiek" } }), "partial");
  assertEquals(pickScenario({ input: { type: "url", value: "https://example.com" } }), "url");
  assertEquals(pickScenario({ input: { type: "image", value: "data:…" } }), "image");
  const a = pickScenario({ input: { type: "text", value: "to samo" } });
  assertEquals(pickScenario({ input: { type: "text", value: "to samo" } }), a);
});

Deno.test("live pipeline outputs match the same schema (no keys, no network)", async () => {
  const deps = { config: loadConfig({ get: () => undefined }), store: new MemoryCheckStore(), corpus: new MemoryCorpusStore() };
  for (const value of ["   ", "Polska ma 38 milionów mieszkańców."]) {
    const r = await runCheck({ input: { type: "text", value } }, deps);
    valid(r);
    assertEquals(r.meta.mode, "live");
  }
});
