import { assert, assertEquals } from "jsr:@std/assert@^1";
import { IndexedCorpusStore } from "../src/store/indexed-corpus.ts";
import type { SourceRecord } from "../src/connectors/types.ts";

function record(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    source_id: "corpus:test:1",
    route: "corpus",
    title: "Komunikat",
    publisher: "Urząd",
    url: "https://gov.pl/test",
    published_at: "2026-05-10",
    retrieved_at: "2026-11-21T00:00:00Z",
    tier: "official",
    origin_key: "gov:test",
    text: "W Warszawie utworzono nowy szpital wojewódzki.",
    start_offset: 0,
    end_offset: 45,
    ...overrides,
  };
}

const officials = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    record({
      source_id: `official:${i}`,
      text: `Komunikat o szpitalu numer ${i} w Warszawie, jeden z wielu komunikatów urzędowych.`,
    }));

const factcheck = record({
  source_id: "factcheck:best",
  tier: "factcheck",
  publisher: "Demagog",
  origin_key: "publisher:demagog",
  url: "https://demagog.org.pl/wypowiedzi/szpital",
  title: "Szpital wojewódzki w Warszawie nowy",
  text: "Nowy szpital wojewódzki w Warszawie utworzono w 2026 roku, szpital szpital.",
});

Deno.test("fusion: the best fact-check is reachable with a single query, even with 5+ official matches", async () => {
  const store = new IndexedCorpusStore([...officials(12), factcheck]);
  const hits = await store.search(["nowy szpital wojewódzki Warszawa"], 5);
  assertEquals(hits.length, 5);
  assert(hits.some((h) => h.source_id === "factcheck:best"), "fact-check missing from the top 5");
  // The best record of each tier is ranked first within its own list, so the two top the fusion.
  assertEquals(hits.slice(0, 2).map((h) => h.tier).sort(), ["factcheck", "official"]);
});

Deno.test("fusion: results are stable (equal scores break by source_id) and the filter is applied lazily", async () => {
  const twins = Array.from({ length: 6 }, (_, i) => record({ source_id: `official:${5 - i}` }));
  const store = new IndexedCorpusStore(twins);
  const first = (await store.search(["szpital"], 3)).map((h) => h.source_id);
  assertEquals(first, ["official:0", "official:1", "official:2"]);

  let calls = 0;
  const view = store.view((r) => {
    calls++;
    return r.source_id === "official:0";
  });
  assertEquals((await view.search(["szpital"], 3)).map((h) => h.source_id), [
    "official:1",
    "official:2",
    "official:3",
  ]);
  assertEquals(calls, 4, "predicate runs only until `limit` records are kept (1 excluded + 3 kept)");
});
