import { assert, assertEquals } from "jsr:@std/assert@^1";
import { IndexedCorpusStore } from "../src/store/indexed-corpus.ts";
import type { SourceRecord } from "../src/connectors/types.ts";
import { trustedSourceFor } from "../src/sources/catalog.ts";

function record(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    source_id: "corpus:test:1",
    route: "corpus",
    title: "Komunikat urzędowy",
    publisher: "Urząd",
    url: "https://gov.pl/test",
    published_at: "2026-05-10",
    retrieved_at: "2026-11-21T00:00:00Z",
    tier: "official",
    origin_key: "gov:test",
    text: "W Warszawie utworzono nowy szpital wojewódzki.",
    start_offset: 12,
    end_offset: 57,
    ...overrides,
  };
}

Deno.test("IndexedCorpusStore: hit, literal text and offsets", async () => {
  const store = new IndexedCorpusStore([record({})]);
  const hits = await store.search(["szpital Warszawa"], 5);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].text, "W Warszawie utworzono nowy szpital wojewódzki.");
  assertEquals(hits[0].start_offset, 12);
  assertEquals(hits[0].end_offset, 57);
});

Deno.test("IndexedCorpusStore: empty result and missing index state", async () => {
  const store = new IndexedCorpusStore([record({})]);
  assertEquals(await store.search(["kosmiczny statek"], 5), []);
  const missing = new IndexedCorpusStore();
  assertEquals(missing.indexStatus().state, "missing");
  assertEquals(missing.size(), 0);
  const broken = new IndexedCorpusStore();
  await broken.loadIndex("/definitely/missing/corpus-index.json");
  assertEquals(broken.indexStatus().state, "invalid");
});

Deno.test("IndexedCorpusStore: Polish inflections and diacritics", async () => {
  const store = new IndexedCorpusStore([record({ text: "Szpitale wojewódzkie przyjmują pacjentów." })]);
  assert((await store.search(["szpital wojewódzki"], 5)).length > 0);
});

Deno.test("IndexedCorpusStore: date and source filters", async () => {
  const store = new IndexedCorpusStore([
    record({ source_id: "old", published_at: "2024-01-10", url: "https://gov.pl/stare" }),
    record({ source_id: "new", published_at: "2026-05-10", url: "https://cert.pl/alert" }),
  ]);
  assertEquals(
    (await store.search(["szpital"], 5, { dateFrom: "2026-01-01", dateTo: "2026-12-31" })).length,
    1,
  );
  assertEquals((await store.search(["szpital"], 5, { sources: ["cert.pl"] })).length, 1);
});

Deno.test("catalog assigns cert.pl and imgw.pl official tiers", () => {
  assertEquals(trustedSourceFor("https://www.cert.pl/alerty")?.tier, "official");
  assertEquals(trustedSourceFor("https://danepubliczne.imgw.pl/")?.tier, "official");
});
