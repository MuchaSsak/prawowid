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
