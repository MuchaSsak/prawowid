/**
 * Source registry prototype (architecture/source-platform.md): eligibility, atomic publish, in-flight
 * disable, versioned corpus, freshness, ingestion racing a disable, corrupt registry file.
 * Synthetic publishers and documents only (rule 16).
 */
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@^1";
import {
  type Binding,
  checkEligibility,
  type ClaimQuery,
  constrainedFetch,
  type DocumentInput,
  EvidenceAccess,
  FileRegistryStore,
  Ingestor,
  MemoryRegistryStore,
  MemoryVersionedCorpus,
  parseFeed,
  type Publisher,
  type Registry,
  REGISTRY_UNAVAILABLE_PL,
  RegistryUnavailableError,
  RegistryValidationError,
  resolveCitation,
  runCheck,
  seedRegistry,
  UNSUPPORTED_SCOPE,
  validateRegistry,
} from "../src/mod.ts";
import { retrieve } from "../src/pipeline/retrieve.ts";
import { assess, deps, extraction, factCheck, stubFetch, T } from "./harness.ts";

const pub = (id: string, scopes: Publisher["scopes"], extra: Partial<Publisher> = {}): Publisher => ({
  id,
  name: id,
  kind: "official",
  tier: "official",
  role: "evidence",
  country: "PL",
  scopes,
  credentials: "",
  terms: "",
  active: true,
  ...extra,
});
const reg = (publishers: Publisher[], bindings: Binding[] = [], links: Registry["links"] = []): Registry => ({
  revision: 1,
  published_at: "2026-11-22T00:00:00Z",
  published_by: "test",
  publishers,
  bindings,
  links,
});
const corpusBinding = (id: string, publisher: string, extra: Partial<Binding> = {}): Binding => ({
  id,
  label: id,
  publisher_id: publisher,
  aggregator: false,
  adapter: "upload",
  mode: "corpus",
  config: {},
  allowed_hosts: [],
  credential_env: null,
  required: false,
  capabilities: ["documents"],
  doc_kind: "dated_statement",
  freshness_days: null,
  active: true,
  ...extra,
});

// ── Eligibility ──────────────────────────────────────────────────────────────

const GOV = [
  pub("gov_pl", [{ host: "gov.pl" }]),
  pub("gus", [{ host: "stat.gov.pl" }]),
  pub("msz", [{ host: "gov.pl", path_prefix: "/web/dyplomacja" }]),
  pub("msz_travel", [{ host: "gov.pl", path_prefix: "/web/dyplomacja/informacje-dla-podrozujacych" }]),
];

Deno.test("eligibility: the most specific scope wins (host labels, then the longest path prefix, segment-aware)", () => {
  const who = (u: string) => {
    const r = resolveCitation(u, GOV);
    return r.ok ? r.publisher.id : r.reason;
  };
  assertEquals(who("https://www.gov.pl/web/dyplomacja/informacje-dla-podrozujacych/ukraina"), "msz_travel");
  assertEquals(who("https://www.gov.pl/web/dyplomacja/komunikat"), "msz");
  assertEquals(who("https://www.gov.pl/web/dyplomacjax"), "gov_pl");
  assertEquals(who("https://bdl.stat.gov.pl/api/v1/data"), "gus");
  assertEquals(who("https://example.com/a"), "url_out_of_scope");
  assertEquals(who("not a url"), "bad_url");
});

Deno.test("eligibility: two publishers on the same scope are ambiguous, and validation rejects the conflict", () => {
  const twins = [
    pub("a_pub", [{ host: "shared.pl", path_prefix: "/news" }]),
    pub("b_pub", [{ host: "shared.pl", path_prefix: "/news/" }]),
  ];
  const r = resolveCitation("https://shared.pl/news/1", twins);
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.reason, "url_ambiguous");
  const errors = validateRegistry({ publishers: twins, bindings: [], links: [] });
  assert(errors.some((e) => e.includes("dwóch wydawców")), errors.join("; "));
});

Deno.test("eligibility: an aggregator record needs an active link; a direct binding only its own publisher", () => {
  const r = reg(
    [
      pub("fc_one", [{ host: "fc-one.pl" }], { tier: "factcheck" }),
      pub("fc_two", [{ host: "fc-two.pl" }]),
      pub("own", [{ host: "own.pl" }]),
    ],
    [
      {
        ...corpusBinding("agg", "own"),
        publisher_id: null,
        aggregator: true,
        adapter: "builtin",
        mode: "live",
        config: { connector: "google_factcheck" },
      },
      corpusBinding("own_docs", "own"),
    ],
    [{ binding_id: "agg", publisher_id: "fc_one", active: true }, {
      binding_id: "agg",
      publisher_id: "fc_two",
      active: false,
    }],
  );
  assertEquals(checkEligibility(r, "agg", "https://fc-one.pl/x").ok, true);
  const off = checkEligibility(r, "agg", "https://fc-two.pl/x");
  assertEquals(!off.ok && off.reason, "link_inactive");
  const none = checkEligibility(r, "agg", "https://own.pl/x");
  assertEquals(!none.ok && none.reason, "link_missing");
  const other = checkEligibility(r, "own_docs", "https://fc-one.pl/x");
  assertEquals(!other.ok && other.reason, "publisher_mismatch");
  r.publishers[0].active = false;
  const pOff = checkEligibility(r, "agg", "https://fc-one.pl/x");
  assertEquals(!pOff.ok && pOff.reason, "publisher_inactive");
});

Deno.test("seed: today's catalog and routes become a valid registry (Google Fact Check = one aggregator binding)", () => {
  const s = seedRegistry();
  assertEquals(validateRegistry(s), []);
  assertEquals(s.bindings.filter((b) => b.aggregator).map((b) => b.id), ["google_factcheck"]);
  assert(s.links.some((l) => l.publisher_id === "demagog"));
  assertEquals(s.bindings.find((b) => b.id === "policja_upload")?.mode, "corpus");
});

Deno.test("seed: every builtin binding runs today's connector under the same route id", async () => {
  const store = new MemoryRegistryStore();
  await store.init(seedRegistry);
  const access = new EvidenceAccess(store, new MemoryVersionedCorpus(), { config: deps().config });
  const ids = access.connectors(await store.read()).map((c) => c.id);
  assertEquals(ids, ["google_factcheck", "sejm_eli", "eurostat", "nbp", "gus_bdl", "corpus"]);
});

Deno.test("validation: destinations outside allowed hosts and credential values are rejected", () => {
  const s = seedRegistry();
  s.bindings.push(corpusBinding("feed", "policja", {
    adapter: "rss",
    config: { feed_url: "https://evil.example.org/rss" },
    allowed_hosts: ["policja.pl"],
    credential_env: "sk-live-123",
  }));
  const errors = validateRegistry(s);
  assert(errors.some((e) => e.includes("spoza dozwolonych")), errors.join("; "));
  assert(errors.some((e) => e.includes("credential_env")), errors.join("; "));
});

// ── Store: atomic publish, corrupt file ──────────────────────────────────────

Deno.test("store: concurrent publishes are serialized; each bumps the revision once and is audited; invalid ones change nothing", async () => {
  const dir = await Deno.makeTempDir();
  const store = new FileRegistryStore(`${dir}/registry.json`);
  assertEquals((await store.init(seedRegistry)).seeded, true);
  await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      store.publish(`op${i}`, "disable", `binding gus #${i}`, (n) => {
        n.bindings.find((b) => b.id === "gus_bdl")!.active = i % 2 === 0;
      })
    ),
  );
  assertEquals((await store.read()).revision, 6);
  await assertRejects(
    () =>
      store.publish("op", "edit", "conflict", (n) => n.publishers.push(pub("dup_nbp", [{ host: "nbp.pl" }]))),
    RegistryValidationError,
  );
  const after = await store.read();
  assertEquals(after.revision, 6);
  assert(!after.publishers.some((p) => p.id === "dup_nbp"));
  assertEquals((await store.audit(100)).filter((a) => a.action === "disable").map((a) => a.revision).sort(), [
    2,
    3,
    4,
    5,
    6,
  ]);
  const leftovers = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.includes(".tmp-"));
  assertEquals(leftovers, []);
});

Deno.test({
  ...T,
  name: "store: a corrupt registry file is never replaced by the seed; checks get a retryable state",
  async fn() {
    const dir = await Deno.makeTempDir();
    const path = `${dir}/registry.json`;
    await Deno.writeTextFile(path, "{ to nie jest JSON");
    const store = new FileRegistryStore(path);
    assertEquals((await store.init(seedRegistry)).seeded, false);
    assertEquals(await Deno.readTextFile(path), "{ to nie jest JSON");
    const err = await assertRejects(() => store.read(), RegistryUnavailableError);
    assertEquals(err.reason, "corrupt");

    const s = stubFetch({
      extraction: () => extraction([{ text: "Most w Przykładowie zamknięto w 2025 roku." }]),
    });
    try {
      const d = deps();
      const r = await runCheck({
        input: { type: "text", value: "Most w Przykładowie zamknięto w 2025 roku." },
      }, {
        ...d,
        registry: new EvidenceAccess(store, new MemoryVersionedCorpus(), { config: d.config }),
      });
      assertEquals(r.status, "technical_error");
      assertStringIncludes(r.system_message?.text ?? "", REGISTRY_UNAVAILABLE_PL);
      assertEquals(
        s.calls.filter((c) => c.url.hostname === "openrouter.ai").length,
        0,
        "no model call without a registry",
      );
    } finally {
      s.restore();
    }
  },
});

// ── Pipeline: pinned revision, revalidation at assembly, coverage ───────────

const CLAIM = "Most w Przykładowie zamknięto na stałe w 2025 roku.";
const FC_URL = "https://fc.example/most";

async function registryDeps() {
  const store = new MemoryRegistryStore();
  await store.init(() => {
    const s = seedRegistry();
    s.publishers.push(
      pub("test_fc", [{ host: "fc.example" }], {
        name: "Demagog (test)",
        kind: "fact_checker",
        tier: "factcheck",
      }),
    );
    s.links.push({ binding_id: "google_factcheck", publisher_id: "test_fc", active: true });
    return s;
  });
  const d = deps();
  const access = new EvidenceAccess(store, new MemoryVersionedCorpus(), { config: d.config });
  return { d: { ...d, registry: access }, store, access };
}

Deno.test({
  ...T,
  name:
    "pipeline: a registry record is rewritten from the registry (tier, publisher, origin) and cited by binding",
  async fn() {
    const { d } = await registryDeps();
    const s = stubFetch(
      {
        extraction: () => extraction([{ text: CLAIM }]),
        assessment: assess({ Demagog: { stance: "refutes", needle: "Ocena" } }, "false"),
      },
      { googleFactCheck: () => factCheck("Some Name", "Fałsz", CLAIM, FC_URL) },
    );
    try {
      const r = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      const c = r.claims[0];
      assertEquals(c.verdict, "false");
      assertEquals(c.citations[0].publisher, "Demagog (test)");
      assertEquals(c.citations[0].route, "google_factcheck");
      assertEquals(c.citations[0].tier, "factcheck");
    } finally {
      s.restore();
    }
  },
});

Deno.test({
  ...T,
  name:
    "pipeline: a link disabled during the check turns the claim into a retryable source_unavailable, never cached",
  async fn() {
    const { d, store } = await registryDeps();
    let disabled: Promise<unknown> = Promise.resolve();
    let fired = false;
    const s = stubFetch(
      {
        extraction: () => extraction([{ text: CLAIM }]),
        assessment: (input) => {
          // The operator disables the link while the model is assessing (after the revision was pinned), once.
          if (!fired) {
            disabled = store.publish("op", "disable", "link", (n) => {
              n.links.find((l) => l.publisher_id === "test_fc")!.active = false;
            });
          }
          fired = true;
          return assess({ Demagog: { stance: "refutes", needle: "Ocena" } }, "false")(input);
        },
      },
      { googleFactCheck: () => factCheck("Demagog", "Fałsz", CLAIM, FC_URL) },
    );
    try {
      const r = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      await disabled;
      const c = r.claims[0];
      assertEquals(c.verdict, null);
      assertEquals(c.system_state, "source_unavailable");
      assertStringIncludes(c.system_message ?? "", "Spróbuj ponownie");
      assertEquals(c.citations, []);
      assertEquals(r.status, "technical_error");
      // Re-enable: the retry runs again (nothing was cached) under the new revision.
      await store.publish("op", "enable", "link", (n) => {
        n.links.find((l) => l.publisher_id === "test_fc")!.active = true;
      });
      const again = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      assertEquals(again.meta.cached, false);
      assertEquals(again.claims[0].verdict, "false");
    } finally {
      s.restore();
    }
  },
});

Deno.test({
  ...T,
  name: "pipeline: cache hits are revalidated, and a new revision misses the cache",
  async fn() {
    const { d, store } = await registryDeps();
    const s = stubFetch(
      {
        extraction: () => extraction([{ text: CLAIM }]),
        assessment: assess({ Demagog: { stance: "refutes", needle: "Ocena" } }, "false"),
      },
      { googleFactCheck: () => factCheck("Demagog", "Fałsz", CLAIM, FC_URL) },
    );
    try {
      await runCheck({ input: { type: "text", value: CLAIM } }, d);
      const hit = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      assertEquals(hit.meta.cached, true);
      // Unreadable registry at assembly of a cache hit: the pinned read fails first → retryable request state.
      store.failReads = true;
      const down = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      assertEquals(down.status, "technical_error");
      store.failReads = false;
      await store.publish("op", "disable", "gus", (n) => {
        n.bindings.find((b) => b.id === "gus_bdl")!.active = false;
      });
      const miss = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      assertEquals(miss.meta.cached, false);
    } finally {
      s.restore();
    }
  },
});

Deno.test({
  ...T,
  name: "pipeline: revalidation that cannot read the registry makes cited claims retryable",
  async fn() {
    const { access, store } = await registryDeps();
    const claim = {
      id: "c1",
      text: CLAIM,
      provenance: "text",
      class: "fact" as const,
      type: null,
      time: "2025",
      risk: "normal" as const,
      verdict: "false" as const,
      verdict_label: "fałszywe",
      system_state: null,
      system_message: null,
      strength: null,
      explanation: "x",
      missing: null,
      warnings: [],
      routes: [],
      citations: [{
        source_id: "s",
        title: "t",
        publisher: "p",
        published_at: null,
        retrieved_at: "",
        url: FC_URL,
        excerpt: "e",
        stance: "refutes" as const,
        tier: "factcheck" as const,
        route: "google_factcheck",
      }],
    };
    store.failReads = true;
    const r = await access.revalidate([claim]);
    assertEquals(r.affected, 1);
    assertEquals(r.claims[0].system_state, "source_unavailable");
  },
});

Deno.test({
  ...T,
  name:
    "coverage: a capability whose only source is disabled is unsupported scope (skipped + warning), not a failure",
  async fn() {
    const { d, store } = await registryDeps();
    await store.publish("op", "disable", "binding google_factcheck", (n) => {
      n.bindings.find((b) => b.id === "google_factcheck")!.active = false;
    });
    const s = stubFetch({ extraction: () => extraction([{ text: CLAIM }]) });
    try {
      const r = await runCheck({ input: { type: "text", value: CLAIM } }, d);
      const c = r.claims[0];
      const route = c.routes.find((x) => x.route === "google_factcheck");
      assertEquals(route?.status, "skipped");
      assertStringIncludes(route?.detail ?? "", UNSUPPORTED_SCOPE);
      assert(c.warnings.some((w) => w.text.includes("jest teraz wyłączone")));
      assertEquals(c.system_state, null);
      assertEquals(c.verdict, "insufficient_evidence");
      assertEquals(s.calls.filter((x) => x.url.hostname === "factchecktools.googleapis.com").length, 0);
    } finally {
      s.restore();
    }
  },
});

// ── Versioned corpus ─────────────────────────────────────────────────────────

const advice = (text: string, published: string, extra: Partial<DocumentInput> = {}): DocumentInput => ({
  document_id: "advice:ua",
  publisher_id: "msz_travel",
  binding_id: "advice_docs",
  kind: "standing_state",
  title: "Ostrzeżenie dla podróżujących: Przykładowo",
  canonical_url: "https://www.gov.pl/web/dyplomacja/informacje-dla-podrozujacych/przykladowo",
  published_at: published,
  retrieved_at: published,
  effective_from: published.slice(0, 10),
  effective_to: null,
  text,
  ...extra,
});
const q = (query: string, extra: Partial<Parameters<MemoryVersionedCorpus["query"]>[0]> = {}) => ({
  query,
  k: 5,
  publisher_ids: ["msz_travel"],
  binding_ids: ["advice_docs"],
  mode: "today" as const,
  today: "2026-11-22",
  freshness: [],
  ...extra,
});

Deno.test("corpus: replace supersedes in one step; today uses the current version, a historical check the one that covered the date", async () => {
  const c = new MemoryVersionedCorpus();
  const v1 = await c.replace([
    advice("Podróże do Przykładowa są odradzane z powodu powodzi.", "2026-01-10T00:00:00Z"),
  ]);
  assertEquals(v1.results[0].status, "new");
  const same = await c.replace([
    advice("Podróże do Przykładowa są odradzane z powodu powodzi.", "2026-01-10T00:00:00Z"),
  ]);
  assertEquals(same.results[0].status, "unchanged");
  assertEquals(same.corpus_revision, v1.corpus_revision);
  const v2 = await c.replace([
    advice("Podróże do Przykładowa są możliwe bez ograniczeń, powodzie ustąpiły.", "2026-06-01T00:00:00Z"),
  ]);
  assertEquals(v2.results[0], { document_id: "advice:ua", version: 2, status: "changed" });
  assertEquals(v2.corpus_revision, v1.corpus_revision + 1);

  const history = await c.history("advice:ua");
  assertEquals(history?.map((v) => [v.version, v.status]), [[2, "current"], [1, "superseded"]]);

  const today = await c.query(q("podróże Przykładowo powodzie"));
  assertEquals(today.hits.map((h) => h.version), [2]);
  const march = await c.query(
    q("podróże Przykładowo powodzie", {
      mode: "historical",
      claim_period: { start: "2026-03-01", end: "2026-03-31" },
    }),
  );
  assertEquals(march.hits.map((h) => h.version), [1]);
});

Deno.test("corpus: publisher and binding filters apply before ranking", async () => {
  const c = new MemoryVersionedCorpus();
  await c.replace([
    advice("Podróże do Przykładowa są odradzane.", "2026-11-01T00:00:00Z"),
    advice("Podróże do Przykładowa są odradzane. Podróże Przykładowo odradzane.", "2026-11-01T00:00:00Z", {
      document_id: "other:1",
      binding_id: "disabled_feed",
    }),
  ]);
  const r = await c.query(q("podróże Przykładowo odradzane"));
  assertEquals(r.hits.map((h) => h.document_id), ["advice:ua"]);
  assertEquals((await c.query(q("podróże", { binding_ids: [] }))).hits, []);
});

Deno.test({
  ...T,
  name:
    "freshness: a stale standing-state record is not evidence; on a required binding it is the stale-data system state",
  async fn() {
    const corpus = new MemoryVersionedCorpus();
    await corpus.replace([
      advice("Podróże do Przykładowa są odradzane z powodu powodzi.", "2026-08-01T00:00:00Z"),
    ]);
    const fresh = await corpus.query(
      q("podróże Przykładowo", { freshness: [{ binding_id: "advice_docs", days: 30 }] }),
    );
    assertEquals(fresh.hits[0].stale, true);

    const store = new MemoryRegistryStore();
    await store.init(() => {
      const s = seedRegistry();
      s.publishers.push(
        pub("msz_travel", [{ host: "gov.pl", path_prefix: "/web/dyplomacja/informacje-dla-podrozujacych" }], {
          name: "MSZ (test)",
        }),
      );
      s.bindings.push(
        corpusBinding("advice_docs", "msz_travel", {
          doc_kind: "standing_state",
          freshness_days: 30,
          required: true,
        }),
      );
      return s;
    });
    const d = deps();
    const access = new EvidenceAccess(store, corpus, {
      config: d.config,
      now: () => new Date("2026-11-22T10:00:00Z"),
    });
    const claim: ClaimQuery = {
      text: "Podróże do Przykładowa są odradzane",
      type: null,
      time: "unknown",
      entities: [],
      search_queries_pl: ["podróże Przykładowo"],
      search_query_en: "",
      indicator: null,
      geo: null,
      claimed_value: null,
      currency: null,
    };
    const r = await retrieve(claim, access.connectors(await store.read()).filter((c) => c.id === "corpus"), {
      config: d.config,
      signal: AbortSignal.timeout(5000),
      corpus: access.corpusView(),
    });
    assertEquals(r.records, []);
    assertEquals(r.requiredFailure?.status, "unavailable");
    assertStringIncludes(r.requiredFailure?.detail ?? "", "nieaktualne");
  },
});

// ── Ingestion and constrained fetch ──────────────────────────────────────────

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title>Komunikat testowy</title><link>https://feed.example.org/news/1</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Pierwszy &amp; jedyny komunikat o testach.</p>]]></description></item>
<item><title>Obcy wpis</title><link>https://elsewhere.example.org/x</link><description>poza zakresem</description></item>
</channel></rss>`;

Deno.test("rss: items are parsed to plain text", () => {
  const items = parseFeed(FEED);
  assertEquals(items.length, 2);
  assertEquals(items[0].text, "Pierwszy & jedyny komunikat o testach.");
  assertEquals(items[0].published_at, "2026-11-20T10:00:00.000Z");
});

async function feedSetup(fetcher: typeof fetch) {
  const store = new MemoryRegistryStore();
  await store.init(() => {
    const s = seedRegistry();
    s.publishers.push(pub("feed_pub", [{ host: "feed.example.org" }]));
    s.bindings.push(
      corpusBinding("feed_rss", "feed_pub", {
        adapter: "rss",
        config: { feed_url: "https://feed.example.org/rss.xml" },
        allowed_hosts: ["feed.example.org"],
      }),
    );
    return s;
  });
  const corpus = new MemoryVersionedCorpus();
  const ingestor = new Ingestor(store, corpus, { fetcher, robots: () => Promise.resolve(true) });
  return { store, corpus, ingestor };
}

Deno.test("ingestion: a sync stores in-scope items and skips the rest", async () => {
  const { corpus, ingestor } = await feedSetup(() =>
    Promise.resolve(new Response(FEED, { headers: { "content-type": "application/rss+xml" } }))
  );
  const s = await ingestor.sync("feed_rss");
  assertEquals([s.status, s.stored, s.skipped], ["ok", 1, 1]);
  assertEquals((await corpus.list({})).documents.map((d) => d.binding_id), ["feed_rss"]);
});

Deno.test("ingestion: a binding disabled while its feed is in flight never publishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { store, corpus, ingestor } = await feedSetup(async () => {
    await gate;
    return new Response(FEED, { headers: { "content-type": "application/rss+xml" } });
  });
  const running = ingestor.sync("feed_rss");
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(ingestor.status("feed_rss").status, "running");
  await store.publish("op", "disable", "binding feed_rss", (n) => {
    n.bindings.find((b) => b.id === "feed_rss")!.active = false;
  });
  release();
  const s = await running;
  assertEquals(s.status, "discarded");
  assertEquals((await corpus.list({ include_superseded: true })).documents, []);
  assertEquals(await corpus.revision(), 0);
});

Deno.test("constrained fetch: only allowed hosts, every redirect hop re-checked", async () => {
  const fetcher = (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/start")) {
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: "https://evil.example.org/x" } }),
      );
    }
    return Promise.resolve(new Response("ok"));
  };
  const opts = {
    allowedHosts: ["feed.example.org"],
    fetcher: fetcher as typeof fetch,
    robots: () => Promise.resolve(true),
  };
  const ok = await constrainedFetch("https://feed.example.org/plain", opts);
  assertEquals(ok.body, "ok");
  await assertRejects(
    () => constrainedFetch("https://feed.example.org/start", opts),
    Error,
    "spoza dozwolonych",
  );
  await assertRejects(() => constrainedFetch("http://feed.example.org/plain", opts), Error, "HTTPS");
  await assertRejects(
    () =>
      constrainedFetch("https://feed.example.org/plain", { ...opts, robots: () => Promise.resolve(false) }),
    Error,
    "robots",
  );
});

Deno.test("upload: needs a public URL in the publisher's scope; replace by document id keeps the history", async () => {
  const store = new MemoryRegistryStore();
  await store.init(seedRegistry);
  const corpus = new MemoryVersionedCorpus();
  const access = new EvidenceAccess(store, corpus, { config: deps().config });
  await assertRejects(
    () =>
      access.upload(
        "policja_upload",
        { title: "t", text: "x", canonical_url: "https://example.com/a" },
        "op",
      ),
    RegistryValidationError,
  );
  const a = await access.upload("policja_upload", {
    title: "Komunikat",
    text: "Wersja pierwsza.",
    canonical_url: "https://policja.pl/pol/a.html",
  }, "op");
  const b = await access.upload("policja_upload", {
    document_id: a.document_id,
    title: "Komunikat",
    text: "Wersja druga.",
    canonical_url: "https://policja.pl/pol/a.html",
  }, "op");
  assertEquals([a.version, b.version, b.status], [1, 2, "changed"]);
  assertEquals((await corpus.history(a.document_id))?.map((v) => v.status), ["current", "superseded"]);
  assert((await store.audit(10)).some((e) => e.action === "upload"));
  // Disabling the publisher removes it from the public view and from corpus search.
  await store.publish("op", "disable", "policja", (n) => {
    n.publishers.find((p) => p.id === "policja")!.active = false;
  });
  const now = await store.read();
  assert(!access.publicSources(now).some((p) => p.id === "policja"));
  const probe = await access.probe({ text: "Wersja druga komunikat" });
  assertEquals(probe.records.filter((r) => r.url.includes("policja.pl")), []);
});
