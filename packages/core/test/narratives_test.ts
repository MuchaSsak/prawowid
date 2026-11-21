/**
 * Known-incident context (EUvsDisinfo): shown next to a claim, never evidence, never a verdict.
 * Scripted model and scripted MCP server, no network. Case texts are synthetic (rule 16).
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { CheckResponseSchema, MemoryKnownIncidentStore, runCheck } from "../src/mod.ts";
import { caseToIncident, normalizeSearch, parseRpcBody, toolPayload } from "../src/narratives/euvsdisinfo/client.ts";
import { assess, deps, extraction, factCheck, stubFetch, T } from "./harness.ts";

const text = (value: string) => ({ input: { type: "text" as const, value } });
const valid = (r: unknown) => assert(CheckResponseSchema.safeParse(r).success, "response must match contract v1");

const CLAIM = "Polska wysyła żołnierzy na Ukrainę";
/** Extraction with an English query the EUvsDisinfo search will use. */
const extractionWith = (en: string) => () => {
  const e = extraction([{ text: CLAIM }]);
  (e.claims[0] as { search_query_en: string }).search_query_en = en;
  return e;
};

const HIT = {
  type: "claim_review",
  title: "Poland is sending troops to Western Ukraine",
  content: "Polish troops are secretly sent to Ukraine to annex its western regions.",
  link: "https://euvsdisinfo.eu/report/synthetic-case-1/",
};

Deno.test({ ...T, name: "EUvsDisinfo match: warning + context_matches; verdict from evidence only, never a citation", async fn() {
  const seen: string[] = [];
  const { calls, restore } = stubFetch({
    extraction: extractionWith("Poland sends troops to Ukraine"),
    assessment: (input) => {
      seen.push(JSON.stringify(input));
      return assess({ Testcheck: { stance: "refutes", needle: "Ocena" } }, "false")(input);
    },
  }, {
    googleFactCheck: () => factCheck("Testcheck", "Fałsz", CLAIM),
    euvsdisinfo: (tool) => (tool === "search" ? [HIT] : []),
  });
  try {
    const r = await runCheck(text(CLAIM), deps({ openrouter: true, google: true, euvsdisinfo: true }));
    valid(r);
    const c = r.claims[0];
    assertEquals(c.verdict, "false");
    assertEquals(c.context_matches?.length, 1);
    assertEquals(c.context_matches?.[0].url, HIT.link);
    assertEquals(c.context_matches?.[0].route, "euvsdisinfo_live");
    assert(c.citations.every((x) => !x.url.includes("euvsdisinfo")), "a known incident is never a citation");
    assert(seen.every((s) => !s.includes("euvsdisinfo")), "the assessment model never reads the incident");
    const w = c.warnings.find((x) => x.type === "known_narrative");
    assertStringIncludes(w!.text, "To kontekst, a nie ocena");
    assertEquals(c.routes.find((x) => x.route === "euvsdisinfo_live")?.status, "hits");
    const call = calls.find((x) => x.url.hostname === "mcp.euvsd.info")!;
    assertEquals(call.url.search, "", "the key never goes in the URL");
    assertEquals((call.body as { params: { arguments: { query: string } } }).params.arguments.query, "Poland sends troops to Ukraine");
  } finally {
    restore();
  }
}});

Deno.test({ ...T, name: "EUvsDisinfo match alone (no evidence): still brak wystarczających dowodów, with the context note", async fn() {
  const { restore } = stubFetch({ extraction: extractionWith("Poland sends troops to Ukraine") }, {
    googleFactCheck: () => ({}),
    euvsdisinfo: () => [HIT],
  });
  try {
    const r = await runCheck(text(CLAIM), deps({ openrouter: true, google: true, euvsdisinfo: true }));
    valid(r);
    assertEquals(r.claims[0].verdict, "insufficient_evidence");
    assertEquals(r.claims[0].citations.length, 0);
    assertEquals(r.claims[0].context_matches?.length, 1);
  } finally {
    restore();
  }
}});

Deno.test({ ...T, name: "EUvsDisinfo: weak overlaps and articles are dropped (no false 'known narrative')", async fn() {
  const { restore } = stubFetch({ extraction: extractionWith("Poland sends troops to Ukraine") }, {
    googleFactCheck: () => ({}),
    euvsdisinfo: () => [
      { type: "claim_review", title: "Ukraine grain exports fall", content: "Exports of grain dropped.", link: "https://euvsdisinfo.eu/report/x/" },
      { type: "article", title: "Poland troops Ukraine analysis", content: "Poland troops Ukraine", link: "https://euvsdisinfo.eu/a/" },
    ],
  });
  try {
    const r = await runCheck(text(CLAIM), deps({ openrouter: true, google: true, euvsdisinfo: true }));
    assertEquals(r.claims[0].context_matches, undefined);
    assert(!r.claims[0].warnings.some((w) => w.type === "known_narrative"));
    assertEquals(r.claims[0].routes.find((x) => x.route === "euvsdisinfo_live")?.status, "no_hits");
  } finally {
    restore();
  }
}});

Deno.test({ ...T, name: "EUvsDisinfo: no key → route skipped, no request; key rejected → unavailable, verdict unchanged", async fn() {
  const run = async (key: boolean, script: () => unknown) => {
    const { calls, restore } = stubFetch({
      extraction: extractionWith("Poland sends troops to Ukraine"),
      assessment: assess({ Testcheck: { stance: "refutes", needle: "Ocena" } }, "false"),
    }, { googleFactCheck: () => factCheck("Testcheck", "Fałsz", CLAIM), euvsdisinfo: script });
    try {
      const r = await runCheck(text(CLAIM), deps({ openrouter: true, google: true, euvsdisinfo: key }));
      valid(r);
      return { r, mcpCalls: calls.filter((c) => c.url.hostname === "mcp.euvsd.info").length };
    } finally {
      restore();
    }
  };
  const none = await run(false, () => [HIT]);
  assertEquals(none.mcpCalls, 0);
  assertEquals(none.r.claims[0].routes.find((x) => x.route === "euvsdisinfo_live")?.status, "skipped");

  const rejected = await run(true, () => new Response("{}", { status: 401 }));
  const c = rejected.r.claims[0];
  assertEquals(c.routes.find((x) => x.route === "euvsdisinfo_live")?.status, "unavailable");
  assertEquals(c.verdict, none.r.claims[0].verdict);
  assertEquals(c.strength, none.r.claims[0].strength, "a context route never adds the 'not all sources' caveat");
}});

Deno.test({ ...T, name: "EUvsDisinfo: a filled incident index takes over from the live search", async fn() {
  const { calls, restore } = stubFetch({ extraction: extractionWith("Poland sends troops to Ukraine") }, {
    googleFactCheck: () => ({}),
    euvsdisinfo: () => [HIT],
  });
  try {
    const d = deps({ openrouter: true, google: true, euvsdisinfo: true });
    const incidents = new MemoryKnownIncidentStore();
    await incidents.upsert([caseToIncident({
      id: "c-1",
      title: "Polish troops will be sent to Ukraine",
      claim: "Poland sends its troops into Ukraine.",
      fact: "There is no such decision.",
      date: 1735689600,
      keywords: [{ title: "Military" }],
      countries: [{ title: "Poland" }],
      linksToDisinformation: [{ url: "https://www.outlet.example/a", language: { name: "Russian" } }],
      url: "https://euvsdisinfo.eu/report/synthetic-case-2/",
    }, "2026-11-21T00:00:00Z")]);
    const r = await runCheck(text(CLAIM), { ...d, incidents });
    valid(r);
    assertEquals(calls.filter((c) => c.url.hostname === "mcp.euvsd.info").length, 0);
    const m = r.claims[0].context_matches?.[0];
    assertEquals(m?.route, "euvsdisinfo_corpus");
    assertEquals(m?.published_at, "2025-01-01T00:00:00.000Z");
    assertEquals(r.claims[0].routes.find((x) => x.route.startsWith("euvsdisinfo"))?.route, "euvsdisinfo_corpus");
  } finally {
    restore();
  }
}});

Deno.test("EUvsDisinfo client: SSE and JSON bodies, wrapped search results, case mapping", () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"results":[{"type":"claim_review","title":"T","content":"C","link":"https://euvsdisinfo.eu/r/"}]}}}\n\n';
  assertEquals(normalizeSearch(toolPayload(parseRpcBody(sse, "text/event-stream"))).length, 1);
  // Live content is WordPress HTML.
  assertEquals(
    normalizeSearch({ results: [{ type: "claim_review", title: "A &amp; B", content: "<p><em>Troops</em> sent&nbsp;to <a href=\"x\">Ukraine</a></p>", link: "https://e/" }] })[0].content,
    "Troops sent to Ukraine",
  );
  const plain = '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"[{\\"type\\":\\"article\\",\\"title\\":\\"A\\",\\"content\\":\\"\\",\\"url\\":\\"https://x/\\"}]"}]}}';
  assertEquals(normalizeSearch(toolPayload(parseRpcBody(plain, "application/json")))[0].link, "https://x/");
  let threw = false;
  try {
    toolPayload({ error: { code: -32001, message: "Invalid API key" } });
  } catch (e) {
    threw = (e as { kind: string }).kind === "unavailable";
  }
  assert(threw, "-32001 maps to unavailable");
  const inc = caseToIncident({
    id: "u", title: "t", claim: "c", fact: "f", date: 0, url: "https://euvsdisinfo.eu/report/u/",
    linksToDisinformation: [{ url: "https://www.a.example/x", language: { name: "Russian" } }, { url: "https://a.example/y" }],
  }, "2026-11-21T00:00:00Z");
  assertEquals(inc.outlet_hosts, ["a.example"]);
  assertEquals(inc.languages, ["Russian"]);
});
