import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { HttpCorpusStore } from "../src/store/http-corpus.ts";

Deno.test("HttpCorpusStore maps retrieval hits to citable SourceRecords", async () => {
  let requested: RequestInit | undefined;
  let requestedUrl = "";
  const store = new HttpCorpusStore("http://retrieval.local/", async (input, init) => {
    requestedUrl = String(input);
    requested = init;
    return new Response(JSON.stringify({
      results: [{
        chunk_id: "doc:1:0",
        document_id: "doc",
        document_version: 1,
        title: "Komunikat Policji",
        publisher: "policja.pl",
        url: "https://policja.pl/a",
        published_at: "2026-11-21T08:00:00Z",
        retrieved_at: "2026-11-21T09:00:00Z",
        quoted_text: "Operacja chroni kolej.",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const records = await store.search(["  bezpieczeństwo kolei ", "operacja"], 5);
  assertEquals(new URL(requestedUrl).pathname, "/search");
  assertEquals(JSON.parse(String(requested?.body)), { query: "bezpieczeństwo kolei operacja", k: 5 });
  assertEquals(records[0], {
    source_id: "corpus:doc:1:0",
    route: "corpus",
    title: "Komunikat Policji",
    publisher: "policja.pl",
    url: "https://policja.pl/a",
    published_at: "2026-11-21T08:00:00Z",
    retrieved_at: "2026-11-21T09:00:00Z",
    tier: "official",
    origin_key: "corpus:doc:1",
    text: "Operacja chroni kolej.",
  });
});

Deno.test("HttpCorpusStore exposes configuration through size", () => {
  assertEquals(new HttpCorpusStore("http://retrieval.local").size(), 1);
  assertEquals(new HttpCorpusStore("").size(), 0);
});

// ── Versioned corpus contract (registry mode), stub fetcher, no network ──────
Deno.test("HttpCorpusStore (versioned): query sends filters + version rule inputs, maps registry fields", async () => {
  const seen: { path: string; body: unknown }[] = [];
  const store = new HttpCorpusStore("http://retrieval.local", (input, init) => {
    const u = new URL(String(input));
    seen.push({ path: `${u.pathname}${u.search}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.pathname === "/search") {
      return Promise.resolve(new Response(JSON.stringify({
        corpus_revision: 7,
        results: [{
          chunk_id: "advice:1:2:0", document_id: "advice:1", document_version: 2, score: 0.91, title: "Ostrzeżenie",
          publisher: "gov.pl", url: "https://www.gov.pl/web/dyplomacja/a", published_at: "2026-06-01T00:00:00+00:00",
          retrieved_at: "2026-06-01T00:00:00+00:00", quoted_text: "Podróże są możliwe.", publisher_id: "msz", binding_id: "msz_docs",
          kind: "standing_state", status: "current", effective_from: "2026-06-01", effective_to: null, stale: true,
        }, { chunk_id: "legacy:1:0", document_id: "legacy", url: "https://x.pl", quoted_text: "bez wydawcy" }],
      })));
    }
    if (u.pathname === "/documents" && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ results: [{ document_id: "d", version: 2, status: "changed" }], corpus_revision: 8 })));
    }
    if (u.pathname === "/revision") return Promise.resolve(new Response(JSON.stringify({ corpus_revision: 8 })));
    if (u.pathname.startsWith("/documents/")) return Promise.resolve(new Response(JSON.stringify({ errors: [{ code: "not_found" }] }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify({ documents: [], corpus_revision: 8 })));
  });
  const res = await store.query({
    query: "podróże", k: 12, publisher_ids: ["msz"], binding_ids: ["msz_docs"], mode: "historical", today: "2026-11-22",
    claim_period: { start: "2026-03-01", end: "2026-03-31" }, freshness: [{ binding_id: "msz_docs", days: 30 }],
  });
  assertEquals(seen[0].body, {
    query: "podróże", k: 12, filters: {}, publisher_ids: ["msz"], binding_ids: ["msz_docs"], mode: "historical", today: "2026-11-22",
    claim_period: { start: "2026-03-01", end: "2026-03-31" }, freshness: [{ binding_id: "msz_docs", days: 30 }],
  });
  assertEquals(res.corpus_revision, 7);
  assertEquals(res.hits.length, 1, "a hit without registry ids is never evidence");
  assertEquals([res.hits[0].version, res.hits[0].kind, res.hits[0].stale, res.hits[0].binding_id], [2, "standing_state", true, "msz_docs"]);

  const rep = await store.replace([{
    document_id: "d", publisher_id: "msz", binding_id: "msz_docs", kind: "dated_statement", title: "t", canonical_url: "https://www.gov.pl/a",
    published_at: null, retrieved_at: "2026-11-22T00:00:00Z", effective_from: null, effective_to: null, text: "x",
  }]);
  assertEquals(rep, { results: [{ document_id: "d", version: 2, status: "changed" }], corpus_revision: 8 });
  assertEquals(await store.revision(), 8);
  assertEquals(await store.history("nope"), null);
  await store.list({ publisher_id: "msz", include_superseded: true, date: "2026-03-01" });
  assertEquals(seen.at(-1)?.path, "/documents?publisher_id=msz&date=2026-03-01&include_superseded=1");
  // Empty id lists never reach the service as "no filter".
  const before = seen.length;
  const none = await store.query({ query: "x", k: 5, publisher_ids: [], binding_ids: ["msz_docs"], mode: "today", today: "2026-11-22", freshness: [] });
  assertEquals(none.hits, []);
  assertEquals(seen.slice(before).map((s) => s.path), ["/revision"]);
});
