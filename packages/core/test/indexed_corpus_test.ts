import { assert, assertEquals } from "jsr:@std/assert@^1";
import { IndexedCorpusStore } from "../src/store/indexed-corpus.ts";
import { expandPages } from "../src/connectors/corpus.ts";
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

Deno.test("IndexedCorpusStore: loadIndex takes a file URL on every OS (Windows pathname is /C:/…)", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/index.json`;
  await Deno.writeTextFile(file, JSON.stringify({ version: 1, records: [record({})] }));
  const { toFileUrl } = await import("jsr:@std/path@^1");
  const store = new IndexedCorpusStore();
  await store.loadIndex(toFileUrl(file));
  assertEquals(store.indexStatus().state, "ready");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("corpus: a hit on a short official page is read as the whole page, chunks joined by offset without overlap", () => {
  const base = { route: "corpus" as const, title: "Przykładowo", publisher: "Urząd Testowy", url: "https://u.example/kraje/PR", published_at: "2026-11-06",
    retrieved_at: "2026-11-21T00:00:00Z", tier: "official" as const, origin_key: "u:t" };
  const store = new IndexedCorpusStore([
    { ...base, source_id: "c:0", start_offset: 0, end_offset: 30, text: "Pierwsze zdanie strony testowej" },
    { ...base, source_id: "c:1", start_offset: 20, end_offset: 52, text: "y testowej. Drugie zdanie strony." },
    { ...base, source_id: "c:2", start_offset: 52, end_offset: 70, text: "Trzecie zdanie tu." },
  ]);
  const out = expandPages([store.pageOf(base.url)[2], store.pageOf(base.url)[0]], store);
  assertEquals(out.length, 1, "one passage per page");
  assertEquals(out[0].source_id, "c:2");
  assertEquals(out[0].text, "Pierwsze zdanie strony testowej. Drugie zdanie strony. Trzecie zdanie tu.");
  // A media page or a long page stays a single chunk.
  const media = { ...store.pageOf(base.url)[0], tier: "media" as const };
  assertEquals(expandPages([media], store)[0].text, "Pierwsze zdanie strony testowej");
});
