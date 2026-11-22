/**
 * Trusted-source allowlist and the official-statistics routes (Eurostat, NBP, GUS), with the
 * code-side number check. Scripted model and scripted APIs, no network, no credits.
 * All values here are synthetic test data (rule 16), not the jury set.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { CheckResponseSchema, loadConfig, MemoryCorpusStore, runCheck } from "../src/mod.ts";
import { decodeJsonStat } from "../src/connectors/eurostat.ts";
import { parseReferenceRates } from "../src/connectors/nbp.ts";
import { INDICATOR_KEYS, parsePeriod } from "../src/connectors/stats-catalog.ts";
import { compareNumber, tolerance } from "../src/pipeline/numeric.ts";
import { claimExtractionSystem } from "../src/prompts/claim-extraction.v2.ts";
import { TRUSTED_SOURCES, trustedSourceFor } from "../src/sources/catalog.ts";
import { assess, deps, extraction, jsonStat, stubFetch, T } from "./harness.ts";

const text = (value: string) => ({ input: { type: "text" as const, value } });
const valid = (r: unknown) => assert(CheckResponseSchema.safeParse(r).success, "response must match contract v1");
const openrouterCalls = <C extends { url: URL }>(calls: C[]) => calls.filter((c) => c.url.hostname === "openrouter.ai");

function gfcReview(url: string, publisher: string, rating: string, claimText: string) {
  return {
    claims: [{
      text: claimText,
      claimDate: "2025-03-01T00:00:00Z",
      claimReview: [{ publisher: { name: publisher, site: new URL(url).hostname }, url, title: `Weryfikacja: ${claimText}`, reviewDate: "2025-03-05T00:00:00Z", textualRating: rating, languageCode: "pl" }],
    }],
  };
}

// ── Allowlist ────────────────────────────────────────────────────────────────

Deno.test("allowlist: matches hosts and subdomains, rejects look-alike domains", () => {
  assertEquals(trustedSourceFor("https://www.reuters.com/fact-check/x")?.id, "reuters");
  assertEquals(trustedSourceFor("https://apnews.com/article/x")?.id, "ap");
  assertEquals(trustedSourceFor("https://sprawdzam.afp.com/x")?.id, "afp");
  assertEquals(trustedSourceFor("https://www.pap.pl/aktualnosci/x")?.id, "pap");
  assertEquals(trustedSourceFor("https://sprawdzamto.pl/artykul/2026-05/x")?.id, "sprawdzam_to");
  assertEquals(trustedSourceFor("https://reuters.com.evil.net/x"), null);
  assertEquals(trustedSourceFor("https://evilreuters.com/x"), null);
  assertEquals(trustedSourceFor("not a url"), null);
});

Deno.test("allowlist: credentials decide the tier (IFCN fact-check units count alone, newsrooms need a second origin)", () => {
  const tier = (id: string) => TRUSTED_SOURCES.find((s) => s.id === id)?.tier;
  assertEquals(tier("reuters"), "factcheck");
  assertEquals(tier("ap"), "factcheck");
  assertEquals(tier("demagog"), "factcheck");
  assertEquals(tier("pap"), "media");
  assertEquals(tier("sprawdzam_to"), "media");
  // Every entry states how it is reached and on what terms (open source catalog).
  for (const s of TRUSTED_SOURCES) assert(s.access_note && s.terms && s.credentials, s.id);
});

Deno.test({ ...T, name: "allowlist: a fact-check from an unlisted site is dropped before the model sees it", async fn() {
  const claim = "Wieża w Przykładowie runęła w 2025 roku.";
  const s = stubFetch(
    { extraction: () => extraction([{ text: claim }]), assessment: assess({}, "insufficient_evidence") },
    { googleFactCheck: () => gfcReview("https://randomblog.test/wieza", "Random Blog", "Fałsz", claim) },
  );
  try {
    const r = await runCheck(text(claim), deps());
    valid(r);
    assertEquals(r.claims[0].verdict, "insufficient_evidence");
    assertEquals(r.claims[0].citations.length, 0);
    assertEquals(openrouterCalls(s.calls).length, 1, "no assessment call when nothing trusted was found");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "allowlist: Reuters Fact Check alone decides; a lone PAP article does not (needs a second origin)", async fn() {
  const claim = "Wieża w Przykładowie runęła w 2025 roku.";
  const run = async (url: string, publisher: string) => {
    const s = stubFetch(
      { extraction: () => extraction([{ text: claim }]), assessment: assess({ [publisher]: { stance: "refutes", needle: "Ocena" } }, "false") },
      { googleFactCheck: () => gfcReview(url, publisher, "Fałsz", claim) },
    );
    try {
      return await runCheck(text(claim), deps());
    } finally {
      s.restore();
    }
  };
  const reuters = await run("https://www.reuters.com/fact-check/wieza", "Reuters");
  assertEquals(reuters.claims[0].verdict, "false");
  assertEquals(reuters.claims[0].citations[0].tier, "factcheck");
  const pap = await run("https://www.pap.pl/aktualnosci/wieza", "PAP");
  assertEquals(pap.claims[0].verdict, "insufficient_evidence");
  assertEquals(pap.claims[0].citations[0].tier, "media");
} });

// ── Eurostat + number check ──────────────────────────────────────────────────

const EU_VALUES: Record<string, number> = {
  AT: 5.2, BE: 5.7, BG: 4.2, CY: 4.9, CZ: 2.6, DE: 3.4, DK: 6.2, EE: 7.6, EL: 10.1, ES: 11.4, FI: 8.4, FR: 7.4, HR: 5.0, HU: 4.5,
  IE: 4.3, IT: 6.5, LT: 7.1, LU: 6.4, LV: 6.9, MT: 3.1, NL: 3.7, PL: 2.9, PT: 6.4, RO: 5.4, SE: 8.4, SI: 3.7, SK: 5.3,
};
const PL_SERIES = [
  { geo: "PL", time: "2020", value: 3.2 }, { geo: "PL", time: "2021", value: 3.4 }, { geo: "PL", time: "2022", value: 2.9 },
  { geo: "PL", time: "2023", value: 2.8 }, { geo: "PL", time: "2024", value: 2.9 }, { geo: "PL", time: "2025", value: 3.1, flag: "p" },
];
const eurostatStub = (url: URL) => {
  if (url.searchParams.get("geo") === "PL") return jsonStat(PL_SERIES);
  const t = url.searchParams.get("time")!;
  return jsonStat([{ geo: "EU27_2020", time: t, value: 5.9 }, ...Object.entries(EU_VALUES).map(([geo, value]) => ({ geo, time: t, value }))]);
};
const UNEMPLOYMENT = (claimed: number, time = "2024") => ({
  text: `Stopa bezrobocia w Polsce w ${time} roku wyniosła ${String(claimed).replace(".", ",")}%.`,
  type: "numeric",
  time,
  indicator: "unemployment_rate",
  geo: "PL",
  claimed_value: claimed,
});

Deno.test({ ...T, name: "Eurostat: official series supports a matching number → potwierdzone, cited as Eurostat with the exact line", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([UNEMPLOYMENT(2.9)]), assessment: assess({ Eurostat: { stance: "supports", needle: "2024: 2,9%" } }, "confirmed") },
    { googleFactCheck: () => ({}), eurostat: eurostatStub, gus: () => new Response("down", { status: 503 }) },
  );
  try {
    const r = await runCheck(text(UNEMPLOYMENT(2.9).text), deps());
    valid(r);
    const c = r.claims[0];
    assertEquals(c.verdict, "confirmed");
    assertEquals(c.citations[0].publisher, "Eurostat");
    assertEquals(c.citations[0].tier, "official");
    assertEquals(c.citations[0].excerpt, "2024: 2,9%");
    assertStringIncludes(c.citations[0].url, "ec.europa.eu/eurostat/databrowser/view/une_rt_a");
    assert(c.routes.some((x) => x.route === "eurostat" && x.status === "hits"));
    // The record the model read carries the EU comparison written by code.
    const assessCall = openrouterCalls(s.calls).find((x) => x.rawBody.includes("evidence_assessment"))!;
    assertStringIncludes(assessCall.rawBody, "Polska w 2024: 2. miejsce od najniższej");
    assertStringIncludes(assessCall.rawBody, "Najniższa wartość w UE w 2024: Czechy, 2,6%");
    assertStringIncludes(assessCall.rawBody, "Unia Europejska (27 państw) w 2024: 5,9%");
    assertStringIncludes(assessCall.rawBody, "2025: 3,1% (dane tymczasowe)");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "number check: the model's 'supports' for a wrong number is downgraded → never confirmed", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([UNEMPLOYMENT(5.2)]), assessment: assess({ Eurostat: { stance: "supports", needle: "2024: 2,9%" } }, "confirmed") },
    { googleFactCheck: () => ({}), eurostat: eurostatStub, gus: () => new Response("down", { status: 503 }) },
  );
  const d = deps();
  try {
    const r = await runCheck(text(UNEMPLOYMENT(5.2).text), d);
    assertEquals(r.claims[0].verdict, "insufficient_evidence");
    assert(d.store.events.some((e) => e.type === "number_check" && (e.detail as { from: string }).from === "supports"));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "number check: 'refutes' for a number that matches the official value is downgraded → never false", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([UNEMPLOYMENT(3)]), assessment: assess({ Eurostat: { stance: "refutes", needle: "2024: 2,9%" } }, "false") },
    { googleFactCheck: () => ({}), eurostat: eurostatStub, gus: () => new Response("down", { status: 503 }) },
  );
  try {
    const r = await runCheck(text(UNEMPLOYMENT(3).text), deps());
    assert(r.claims[0].verdict !== "false", "a rounded match must not be called false");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "number check: a number from another year is flagged (2021 value claimed for 2024)", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([UNEMPLOYMENT(3.4)]), assessment: assess({ Eurostat: { stance: "misleading", needle: "2021: 3,4%" } }, "misleading") },
    { googleFactCheck: () => ({}), eurostat: eurostatStub, gus: () => new Response("down", { status: 503 }) },
  );
  try {
    const r = await runCheck(text(UNEMPLOYMENT(3.4).text), deps());
    assertEquals(r.claims[0].verdict, "misleading");
    assert(r.claims[0].warnings.some((w) => w.text.includes("danym za 2021")));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "J: Eurostat down for a statistics claim → technical state, never a verdict", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([UNEMPLOYMENT(2.9)]), assessment: assess({}, "insufficient_evidence") },
    { googleFactCheck: () => ({}), eurostat: () => new Response("down", { status: 503 }), gus: () => new Response("down", { status: 503 }) },
  );
  try {
    const r = await runCheck(text(UNEMPLOYMENT(2.9).text), deps());
    valid(r);
    assertEquals(r.claims[0].verdict, null);
    assertEquals(r.claims[0].system_state, "technical_error");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "GUS (optional) down while Eurostat answers → verdict stands, the gap is disclosed", async fn() {
  const claim = { text: "Polska liczy 36,5 mln mieszkańców.", type: "numeric", time: "2025", indicator: "population", geo: "PL", claimed_value: 36500000 };
  const s = stubFetch(
    { extraction: () => extraction([claim]), assessment: assess({ Eurostat: { stance: "supports", needle: "2025: 36 497 495" } }, "confirmed") },
    {
      googleFactCheck: () => ({}),
      eurostat: (u) => u.searchParams.get("geo") === "PL"
        ? jsonStat([{ geo: "PL", time: "2024", value: 36620970 }, { geo: "PL", time: "2025", value: 36497495 }])
        : jsonStat([{ geo: "PL", time: "2025", value: 36497495 }]),
      gus: () => new Response("down", { status: 503 }),
    },
  );
  try {
    const r = await runCheck(text(claim.text), deps());
    const c = r.claims[0];
    assertEquals(c.verdict, "confirmed");
    assert(c.routes.some((x) => x.route === "gus_bdl" && x.status === "error" && !x.required));
    assert(c.strength!.reasons.some((x) => x.includes("nie wszystkie bazy")));
  } finally {
    s.restore();
  }
} });

// ── NBP ──────────────────────────────────────────────────────────────────────

Deno.test({ ...T, name: "NBP: exchange rate on a date → the rate in force that day, cited from NBP", async fn() {
  const claim = { text: "2 czerwca 2025 r. euro kosztowało 4,26 zł.", type: "numeric", time: "2025-06-02", indicator: "exchange_rate", geo: "PL", claimed_value: 4.26, currency: "EUR" };
  const s = stubFetch(
    { extraction: () => extraction([claim]), assessment: assess({ "Narodowy Bank Polski": { stance: "supports", needle: "obowiązujący w dniu" } }, "confirmed") },
    {
      googleFactCheck: () => ({}),
      nbp: (u) => {
        assertStringIncludes(u.pathname, "/exchangerates/rates/a/eur/2025-05-26/2025-06-02/");
        return { currency: "euro", code: "EUR", rates: [{ no: "104/A/NBP/2025", effectiveDate: "2025-05-30", mid: 4.2419 }, { no: "105/A/NBP/2025", effectiveDate: "2025-06-02", mid: 4.2578 }] };
      },
    },
  );
  try {
    const r = await runCheck(text(claim.text), deps());
    const c = r.claims[0];
    assertEquals(c.verdict, "confirmed");
    assertEquals(c.citations[0].publisher, "Narodowy Bank Polski");
    assertEquals(c.citations[0].excerpt, "Kurs obowiązujący w dniu 2025-06-02: 4,2578 zł (notowanie z 2025-06-02)");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "NBP: no quotes in the window (404) is 'no hits', not a failure", async fn() {
  const claim = { text: "Euro kosztowało 4 zł w 2031 roku.", type: "numeric", time: "2031", indicator: "exchange_rate", geo: "PL", claimed_value: 4, currency: "EUR" };
  const s = stubFetch(
    { extraction: () => extraction([claim]), assessment: assess({}, "insufficient_evidence") },
    { googleFactCheck: () => ({}), nbp: () => new Response("404 NotFound - Not Found - Brak danych", { status: 404 }) },
  );
  try {
    const r = await runCheck(text(claim.text), deps());
    assertEquals(r.claims[0].verdict, "insufficient_evidence");
    assertEquals(r.claims[0].system_state, null);
  } finally {
    s.restore();
  }
} });

Deno.test("NBP: reference-rate history merges the archive and the current file, keeping only changes", () => {
  const archive = `<stopy_procentowe_archiwum>
    <pozycje obowiazuje_od="2023-09-07"><pozycja id="ref" oprocentowanie="6,00" /><pozycja id="lom" oprocentowanie="6,50" /></pozycje>
    <pozycje obowiazuje_od="2023-10-05"><pozycja id="ref" oprocentowanie="5,75" /></pozycje>
    <pozycje obowiazuje_od="2023-11-01"><pozycja id="ref" oprocentowanie="5,75" /><pozycja id="lom" oprocentowanie="6,00" /></pozycje>
  </stopy_procentowe_archiwum>`;
  const current = `<stopy_procentowe><tabela id="stoproc"><pozycja id="ref" nazwa="Stopa referencyjna" oprocentowanie="3,75" trend="spadek" obowiazuje_od="2026-03-05" /></tabela></stopy_procentowe>`;
  assertEquals(parseReferenceRates(archive, current), [
    { period: "2023-09-07", value: 6 },
    { period: "2023-10-05", value: 5.75 },
    { period: "2026-03-05", value: 3.75 },
  ]);
});

// ── Units ────────────────────────────────────────────────────────────────────

Deno.test("JSON-stat decoding maps flat indices back to geo and time", () => {
  const rows = decodeJsonStat(jsonStat([{ geo: "PL", time: "2024", value: 2.9 }, { geo: "DE", time: "2023", value: 3.1, flag: "p" }]));
  assertEquals(rows.find((r) => r.geo === "PL" && r.time === "2024")?.value, 2.9);
  assertEquals(rows.find((r) => r.geo === "DE" && r.time === "2023")?.flag, "p");
});

Deno.test("number check: tolerance follows the claim's stated precision", () => {
  assertEquals(tolerance(3, "percent"), 0.5);
  assert(Math.abs(tolerance(2.9, "percent") - 0.058) < 1e-9);
  assertEquals(tolerance(37000000, "number"), 740000);
  const data = { indicator: "x", unit: "%", kind: "percent" as const, points: [{ period: "2023", value: 2.8 }, { period: "2024", value: 2.9 }], target_periods: ["2024"] };
  assertEquals(compareNumber(2.9, data).match, "matches");
  assertEquals(compareNumber(3, data).match, "matches");
  assertEquals(compareNumber(2.8, data).match, "other_period");
  assertEquals(compareNumber(5.2, data).match, "differs");
  assertEquals(compareNumber(null, data).match, "no_check");
  const deficit = { ...data, compare_abs: true, points: [{ period: "2024", value: -6.6 }] };
  assertEquals(compareNumber(6.6, deficit).match, "matches");
});

Deno.test("claim period parsing: dates, months, years, ranges, unknown", () => {
  assertEquals(parsePeriod("2025-06-02"), { year: 2025, month: 6, day: "2025-06-02" });
  assertEquals(parsePeriod("2025-06"), { year: 2025, month: 6, day: null });
  assertEquals(parsePeriod("2020-2024"), { year: 2024, month: null, day: null });
  assertEquals(parsePeriod("unknown"), { year: null, month: null, day: null });
});

Deno.test("extraction prompt lists every catalog indicator (generated from the catalog, not from cases)", () => {
  const p = claimExtractionSystem("Polish");
  for (const k of INDICATOR_KEYS) assertStringIncludes(p, `  ${k}: `);
});

Deno.test({ ...T, name: "opinions never trigger statistics lookups", async fn() {
  const s = stubFetch({ extraction: () => extraction([{ text: "Bezrobocie to najgorsza plaga naszych czasów.", class: "opinion" }]) });
  try {
    const r = await runCheck(text("Bezrobocie to najgorsza plaga naszych czasów."), deps());
    assertEquals(r.claims[0].verdict, "not_verifiable");
    assert(!s.calls.some((c) => ["ec.europa.eu", "api.nbp.pl", "bdl.stat.gov.pl"].includes(c.url.hostname)));
  } finally {
    s.restore();
  }
} });


Deno.test({ ...T, name: "tie: 'partly false' from one fact-checker vs 'false' from another → fałszywe (refutation wins a tie)", async fn() {
  const claim = "Noszenie hełmu w Przykładowie powoduje utratę słuchu.";
  const s = stubFetch(
    {
      extraction: () => extraction([{ text: claim }]),
      assessment: assess({ Demagog: { stance: "refutes", needle: "Ocena" }, "USA Today": { stance: "misleading", needle: "Ocena" } }, "false"),
    },
    {
      googleFactCheck: () => ({
        claims: [
          ...gfcReview("https://demagog.org.pl/analizy/helm", "Demagog", "Fałsz", claim).claims,
          ...gfcReview("https://www.usatoday.com/story/helmet", "USA Today", "Partly false", claim).claims,
        ],
      }),
    },
  );
  try {
    const r = await runCheck(text(claim), deps());
    assertEquals(r.claims[0].verdict, "false");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "one publisher is one origin: two articles by the same newsroom are not two confirmations", async fn() {
  const claim = "Wieża w Przykładowie runęła w 2025 roku.";
  const s = stubFetch(
    { extraction: () => extraction([{ text: claim }]), assessment: assess({ PAP: { stance: "refutes", needle: "Ocena" } }, "false") },
    {
      googleFactCheck: () => ({
        claims: [
          ...gfcReview("https://www.pap.pl/aktualnosci/wieza-1", "PAP", "Fałsz", claim).claims,
          ...gfcReview("https://www.pap.pl/aktualnosci/wieza-2", "PAP", "Fałsz", claim).claims,
        ],
      }),
    },
  );
  try {
    const r = await runCheck(text(claim), deps());
    assertEquals(r.claims[0].verdict, "insufficient_evidence", "two PAP articles must not reach the two-origin threshold");
  } finally {
    s.restore();
  }
} });

Deno.test("Sejm ELI: a claim naming an act runs whatever its type; the claim's year finds an old base act", async () => {
  const { sejmEli } = await import("../src/connectors/sejm-eli.ts");
  const base = { text: "", type: "event" as const, time: "unknown", entities: [], search_queries_pl: [], search_query_en: "", indicator: null, geo: null, claimed_value: null, currency: null };
  assert(sejmEli.appliesTo({ ...base, text: "Konstytucja RP została uchwalona w 1997 roku." }));
  assert(sejmEli.appliesTo({ ...base, text: "Kodeks testowy to akt z 1974 roku." }));
  assert(!sejmEli.appliesTo({ ...base, text: "Most w Przykładowie zamknięto w 2025 roku." }));

  // Synthetic acts: without the year only amendments come back (newest 50); with it, the base act.
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const u = new URL(String(input));
    seen.push(u.search);
    const items = u.searchParams.get("year") === "1974"
      ? [{ address: "WDU19740240141", title: "Ustawa z dnia 26 czerwca 1974 r. Kodeks testowy.", type: "Ustawa" }]
      : [
        { address: "WDU20260000001", title: "Ustawa z dnia 1 marca 2026 r. o zmianie ustawy - Kodeks testowy", type: "Ustawa" },
        { address: "WDU20260000002", title: "Ustawa z dnia 2 marca 2026 r. o osobach testowych", type: "Ustawa" },
      ];
    return Promise.resolve(new Response(JSON.stringify({ count: items.length, items }), { headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  try {
    const records = await sejmEli.search(
      { ...base, type: "legal", text: "Kodeks testowy to ustawa z 26 czerwca 1974 roku.", time: "1974-06-26", search_queries_pl: ["Kodeks testowy"] },
      { config: loadConfig({ get: () => undefined }), signal: AbortSignal.timeout(5000), corpus: new MemoryCorpusStore() },
    );
    assert(seen.some((s) => s.includes("year=1974")), "the claim's year is used");
    assert(seen.some((s) => !s.includes("year=")), "the unfiltered search still runs");
    assertEquals(records.map((r) => r.source_id), ["eli:WDU19740240141"]);
  } finally {
    globalThis.fetch = original;
  }
});
