import { assert, assertEquals } from "jsr:@std/assert@^1";
import type { ClaimQuery, ConnectorContext, SourceRecord } from "../src/connectors/types.ts";
import { pickPassages } from "../src/pipeline/retrieve.ts";
import { gus } from "../src/connectors/gus.ts";
import { GUS_SNAPSHOT } from "../src/connectors/gus-snapshot.ts";
import { loadConfig } from "../src/config.ts";
import { MemoryCorpusStore } from "../src/store/memory.ts";

const rec = (route: string, n: number): SourceRecord => ({
  source_id: `${route}:${n}`,
  route,
  title: `${route} ${n}`,
  publisher: route,
  url: `https://example.org/${route}/${n}`,
  published_at: null,
  retrieved_at: "2026-11-22T00:00:00Z",
  tier: "official",
  origin_key: `${route}:${n}`,
  text: "",
});

Deno.test("pickPassages: a route with many fragments cannot push out another route's only record", () => {
  const ranked = [rec("corpus", 1), rec("corpus", 2), rec("corpus", 3), rec("corpus", 4), rec("corpus", 5), rec("eurostat", 1)];
  const picked = pickPassages(ranked, 5).map((r) => r.source_id);
  assertEquals(picked, ["corpus:1", "corpus:2", "corpus:3", "corpus:4", "eurostat:1"]);
});

Deno.test("pickPassages: plain rank order when one route answers, and never more than the limit", () => {
  const ranked = [1, 2, 3, 4, 5, 6, 7].map((n) => rec("corpus", n));
  assertEquals(pickPassages(ranked, 5).map((r) => r.source_id), ["corpus:1", "corpus:2", "corpus:3", "corpus:4", "corpus:5"]);
  const many = ["a", "b", "c", "d", "e", "f", "g"].map((r) => rec(r, 1));
  assertEquals(pickPassages(many, 5).length, 5);
});

Deno.test("gus: when the live service fails, the saved copy answers and says it is a copy", async () => {
  const claim: ClaimQuery = {
    text: "Polska ma 38 milionów mieszkańców",
    type: null,
    time: "2024",
    entities: [],
    search_queries_pl: [],
    search_query_en: "",
    indicator: "population",
    geo: "PL",
    claimed_value: 38_000_000,
    currency: null,
  };
  const ctx: ConnectorContext = {
    config: loadConfig({ get: () => undefined }),
    signal: new AbortController().signal,
    corpus: new MemoryCorpusStore(),
  };
  const realFetch = globalThis.fetch;
  const saved = GUS_SNAPSHOT[72305];
  // Test values, not real statistics.
  GUS_SNAPSHOT[72305] = { retrieved_at: "2026-11-22T03:00:00.000Z", last_update: null, values: [{ year: "2024", val: 123 }] };
  globalThis.fetch = () => Promise.reject(new TypeError("tls handshake eof"));
  try {
    const [r] = await gus.search(claim, ctx);
    assert(r.text.includes("Kopia danych pobrana z API GUS 2026-11-22"));
    assertEquals(r.retrieved_at, "2026-11-22T03:00:00.000Z");
    assertEquals(r.data?.points, [{ period: "2024", value: 123 }]);
  } finally {
    globalThis.fetch = realFetch;
    if (saved) GUS_SNAPSHOT[72305] = saved;
    else delete GUS_SNAPSHOT[72305];
  }
});
