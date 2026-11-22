import { assert, assertEquals } from "jsr:@std/assert@^1";
import { IndexedCorpusStore } from "../src/store/indexed-corpus.ts";
import type { ClaimQuery, Connector, ConnectorContext, SourceRecord } from "../src/connectors/types.ts";
import { TRUSTED_SOURCES } from "../src/sources/catalog.ts";
import {
  applySourceControls,
  EMPTY_SOURCE_CONTROLS,
  listSources,
  SOURCE_CONTROL_AUDIT_MAX,
  SOURCE_DISABLED_DETAIL,
  setSourceEnabled,
} from "../src/sources/controls.ts";
import { retrieve } from "../src/pipeline/retrieve.ts";
import { loadConfig } from "../src/config.ts";

function rec(collection: string, n: number, url: string, text: string, tier: SourceRecord["tier"] = "official"): SourceRecord {
  return {
    source_id: `corpus:${collection}:${n}:${collection}-${n}`,
    route: "corpus",
    title: `Komunikat ${collection} ${n}`,
    publisher: collection,
    url,
    published_at: "2026-11-1" + n,
    retrieved_at: "2026-11-21T00:00:00Z",
    tier,
    origin_key: `${collection}-${n}`,
    text,
  };
}

const RECORDS = [
  rec("cert_pl", 1, "https://cert.pl/posts/1", "CERT Polska ostrzega przed fałszywymi SMS-ami o dopłacie do paczki."),
  rec("rcb", 2, "https://www.gov.pl/web/rcb/sms", "RCB: fałszywe SMS-y o paczce to próba wyłudzenia danych."),
  rec("demagog", 3, "https://demagog.org.pl/x", "Fałsz: SMS o paczce nie pochodzi od Poczty Polskiej.", "factcheck"),
];

const claim: ClaimQuery = {
  text: "Fałszywe SMS-y o paczce wyłudzają dane",
  type: null,
  time: "2026-11-21",
  entities: [],
  search_queries_pl: ["SMS paczka wyłudzenie"],
  search_query_en: "",
  indicator: null,
  geo: null,
  claimed_value: null,
  currency: null,
};

Deno.test("IndexedCorpusStore.view: hides records while ranking, shares the index", async () => {
  const store = new IndexedCorpusStore(RECORDS);
  const all = await store.search(["SMS paczka"], 5);
  assertEquals(all.length, 3);
  const view = store.view((r) => r.source_id.startsWith("corpus:cert_pl:"));
  const hits = await view.search(["SMS paczka"], 5);
  assertEquals(hits.length, 2);
  assert(hits.every((r) => !r.source_id.startsWith("corpus:cert_pl:")));
  assertEquals(view.size(), 3);
  assertEquals(view.indexStatus().state, "ready");
});

Deno.test("IndexedCorpusStore.collections: counts and newest day per collection", () => {
  const c = new IndexedCorpusStore(RECORDS).collections();
  assertEquals(c.map((x) => x.id).sort(), ["cert_pl", "demagog", "rcb"]);
  assertEquals(c.find((x) => x.id === "rcb"), { id: "rcb", label: "rcb", records: 1, latest: "2026-11-12" });
});

Deno.test("setSourceEnabled: revision, audit newest first, no-op when unchanged, audit capped", () => {
  const off = setSourceEnabled(EMPTY_SOURCE_CONTROLS, "corpus:rcb", false, new Date("2026-11-22T03:00:00Z"));
  assertEquals(off.revision, 1);
  assertEquals(off.disabled, ["corpus:rcb"]);
  assertEquals(off.audit[0], { at: "2026-11-22T03:00:00.000Z", key: "corpus:rcb", enabled: false });
  assertEquals(setSourceEnabled(off, "corpus:rcb", false), off);
  const on = setSourceEnabled(off, "corpus:rcb", true);
  assertEquals(on.disabled, []);
  assertEquals(on.revision, 2);
  let s = EMPTY_SOURCE_CONTROLS;
  for (let i = 0; i < SOURCE_CONTROL_AUDIT_MAX + 5; i++) s = setSourceEnabled(s, "route:gus_bdl", i % 2 === 1);
  assertEquals(s.audit.length, SOURCE_CONTROL_AUDIT_MAX);
});

Deno.test("applySourceControls: collection and publisher switches drop records from the corpus route", async () => {
  const store = new IndexedCorpusStore(RECORDS);
  const corpusRoute: Connector = {
    id: "corpus",
    label: "Korpus",
    required: false,
    appliesTo: () => true,
    unavailableReason: () => null,
    search: (q, ctx) => ctx.corpus.search([q.text], 5),
  };
  const config = loadConfig({ get: () => undefined });
  const run = async (disabled: string[]) => {
    const live = applySourceControls({ connectors: [corpusRoute], corpus: store, trustedSources: TRUSTED_SOURCES }, disabled);
    const ctx: ConnectorContext = { config, signal: new AbortController().signal, corpus: live.corpus };
    return (await retrieve(claim, live.connectors, ctx)).records.map((r) => r.publisher).sort();
  };
  assertEquals(await run([]), ["cert_pl", "demagog", "rcb"]);
  assertEquals(await run(["corpus:demagog"]), ["cert_pl", "rcb"]);
  // A publisher switch works by citation URL host, whatever collection or route the record came from.
  const certId = TRUSTED_SOURCES.find((s) => s.domains.includes("cert.pl"))?.id;
  assert(certId, "cert.pl must be on the allowlist");
  assertEquals(await run([`publisher:${certId}`]), ["demagog", "rcb"]);
});

Deno.test("applySourceControls: a switched-off route is reported, never searched; a required one is a system state", async () => {
  let called = false;
  const required: Connector = {
    id: "sejm_eli",
    label: "Sejm ELI",
    required: true,
    appliesTo: () => true,
    unavailableReason: () => null,
    search: () => {
      called = true;
      return Promise.resolve([]);
    },
  };
  const live = applySourceControls(
    { connectors: [required], corpus: new IndexedCorpusStore([]), trustedSources: TRUSTED_SOURCES },
    ["route:sejm_eli"],
  );
  const ctx: ConnectorContext = { config: loadConfig({ get: () => undefined }), signal: new AbortController().signal, corpus: live.corpus };
  const r = await retrieve(claim, live.connectors, ctx);
  assertEquals(called, false);
  assertEquals(r.routes[0].status, "unavailable");
  assertEquals(r.routes[0].detail, SOURCE_DISABLED_DETAIL);
  assertEquals(r.requiredFailure?.route, "sejm_eli");
});

Deno.test("applySourceControls: switched-off publishers leave the allowlist; listSources marks them", () => {
  const id = TRUSTED_SOURCES[0].id;
  const live = applySourceControls(
    { connectors: [], corpus: new IndexedCorpusStore([]), trustedSources: TRUSTED_SOURCES },
    [`publisher:${id}`],
  );
  assertEquals(live.trustedSources.length, TRUSTED_SOURCES.length - 1);
  const list = listSources({ connectors: [], collections: [], trustedSources: TRUSTED_SOURCES }, [`publisher:${id}`]);
  assertEquals(list.find((s) => s.id === id)?.enabled, false);
  assertEquals(list.filter((s) => !s.enabled).length, 1);
});

Deno.test("applySourceControls: gov.pl off keeps Sejm and GUS records (most specific domain wins)", async () => {
  const sejm = rec("x", 1, "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20180001560", "Ustawa o krajowym systemie cyberbezpieczeństwa.");
  const rcb = rec("x", 2, "https://www.gov.pl/web/rcb/alert", "RCB: alert o silnym wietrze.");
  const route = (id: string, records: SourceRecord[], required = true): Connector => ({
    id,
    label: id,
    required,
    appliesTo: () => true,
    unavailableReason: () => null,
    search: () => Promise.resolve(records.map((r) => ({ ...r, route: id }))),
  });
  const live = applySourceControls(
    { connectors: [route("sejm_eli", [sejm]), route("rcb_like", [rcb], false)], corpus: new IndexedCorpusStore([]), trustedSources: TRUSTED_SOURCES },
    ["publisher:gov_pl"],
  );
  const ctx: ConnectorContext = { config: loadConfig({ get: () => undefined }), signal: new AbortController().signal, corpus: live.corpus };
  const r = await retrieve(claim, live.connectors, ctx);
  assertEquals(r.routes.find((x) => x.route === "sejm_eli")?.status, "hits");
  assertEquals(r.records.map((x) => x.route), ["sejm_eli"]);
  assertEquals(r.requiredFailure, null);
});

Deno.test("applySourceControls: the only publisher of a required route switched off → system state, not 'no hits'", async () => {
  const eurostatRecord = rec("x", 1, "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_aind", "Inflacja HICP: Polska 2023: 10,9%.");
  const eurostat: Connector = {
    id: "eurostat",
    label: "Eurostat",
    required: true,
    appliesTo: () => true,
    unavailableReason: () => null,
    search: () => Promise.resolve([{ ...eurostatRecord, route: "eurostat" }]),
  };
  const live = applySourceControls(
    { connectors: [eurostat], corpus: new IndexedCorpusStore([]), trustedSources: TRUSTED_SOURCES },
    ["publisher:eurostat"],
  );
  const ctx: ConnectorContext = { config: loadConfig({ get: () => undefined }), signal: new AbortController().signal, corpus: live.corpus };
  const r = await retrieve(claim, live.connectors, ctx);
  assertEquals(r.routes[0].status, "unavailable");
  assertEquals(r.routes[0].detail, SOURCE_DISABLED_DETAIL);
  assertEquals(r.requiredFailure?.route, "eurostat");
});

Deno.test("applySourceControls: corpus route off hides the corpus for every reader (dates included)", async () => {
  const store = new IndexedCorpusStore(RECORDS);
  const live = applySourceControls({ connectors: [], corpus: store, trustedSources: TRUSTED_SOURCES }, ["route:corpus"]);
  assertEquals(await live.corpus.search(["SMS paczka"], 5), []);
});

Deno.test("applySourceControls: a connector that filters by the allowlist itself (Google Fact Check) still yields a system state", async () => {
  const demagogId = TRUSTED_SOURCES.find((s) => s.domains.includes("demagog.org.pl"))?.id;
  assert(demagogId, "demagog.org.pl must be on the allowlist");
  const review = rec("x", 1, "https://demagog.org.pl/wypowiedzi/x", "Fałsz: SMS o paczce nie pochodzi od Poczty Polskiej.", "factcheck");
  // Like google-factcheck.ts: drops URLs not on ctx.config.trustedSources.
  const gfc = (required: boolean): Connector => ({
    id: required ? "google_factcheck" : "optional_aggregator",
    label: "GFC",
    required,
    appliesTo: () => true,
    unavailableReason: () => null,
    search: (_q, ctx) =>
      Promise.resolve(
        [{ ...review, route: "google_factcheck" }].filter((r) => ctx.config.trustedSources.some((s) => r.url.includes(s.domains[0]))),
      ),
  });
  const base = loadConfig({ get: () => undefined });
  const live = applySourceControls(
    { connectors: [gfc(true), gfc(false)], corpus: new IndexedCorpusStore([]), trustedSources: TRUSTED_SOURCES },
    [`publisher:${demagogId}`],
  );
  // The API passes the shrunk allowlist in config, exactly as main.ts does.
  const ctx: ConnectorContext = {
    config: { ...base, trustedSources: live.trustedSources },
    signal: new AbortController().signal,
    corpus: live.corpus,
  };
  const r = await retrieve(claim, live.connectors, ctx);
  assertEquals(r.routes.find((x) => x.route === "google_factcheck")?.status, "unavailable");
  assertEquals(r.requiredFailure?.route, "google_factcheck");
  // An optional route whose records were all filtered is not a failure: it simply found nothing usable.
  assertEquals(r.routes.find((x) => x.route === "optional_aggregator")?.status, "no_hits");
  assertEquals(r.records, []);
});
