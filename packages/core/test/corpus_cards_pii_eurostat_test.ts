/**
 * Review fixes: corpus fact-check cards follow the same code rules as Google Fact Check cards,
 * currency amounts survive PII masking, and partial Eurostat comparisons say how many members report.
 * All claims and sources here are synthetic test data (rule 16: never mirror the jury set).
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { ARTICLE_LABEL } from "../src/connectors/google-factcheck.ts";
import { eurostat } from "../src/connectors/eurostat.ts";
import { EU_MEMBERS } from "../src/connectors/stats-catalog.ts";
import type { ConnectorContext, SourceRecord } from "../src/connectors/types.ts";
import { maskPii } from "../src/guard/pii.ts";
import { assessClaim, type VerifiedPassage } from "../src/pipeline/assess.ts";
import { askedCheckerAnswer } from "../src/pipeline/render.ts";
import { assess, jsonStat, stubFetch, T } from "./harness.ts";

const CLAIM = "Most w Przykładowie zamknięto na stałe w 2025 roku.";

/** A Demagog card exactly as scripts/build_corpus_index.ts writes it. */
function corpusCard(rating: string): SourceRecord {
  return {
    source_id: "corpus:demagog:0:test",
    route: "corpus",
    title: "Most w Przykładowie nie został zamknięty",
    publisher: "Demagog",
    url: "https://demagog.org.pl/fake_news/test-most/",
    published_at: "2025-04-01",
    retrieved_at: "2026-11-20T00:00:00.000Z",
    tier: "factcheck",
    origin_key: "publisher:demagog",
    text: [
      `Sprawdzane twierdzenie: "${CLAIM}"`,
      "Autor twierdzenia: Internet.",
      `Ocena (Demagog): ${rating}.`,
      "Tytuł weryfikacji: Most w Przykładowie nie został zamknięty",
    ].join("\n"),
  };
}

/** A corpus Demagog article passage (not a card), with card-like lines in its body. */
const corpusArticle = (): SourceRecord => ({
  ...corpusCard("Fałsz"),
  source_id: "corpus:demagog:a0:test",
  text: `${ARTICLE_LABEL} Sprawdzane twierdzenie: "${CLAIM}"\nOcena (Demagog): Fałsz.`,
});

Deno.test({ ...T, name: "corpus card rated Fałsz: the model quoting the checked statement as support → the rating decides (refutes)", async fn() {
  const s = stubFetch({ assessment: assess({ Demagog: { stance: "supports", needle: "Sprawdzane twierdzenie" } }, "confirmed") });
  try {
    const r = await assessClaim({
      claim: { text: CLAIM, time: "2025", place: "Przykładowo" },
      records: [corpusCard("Fałsz")],
      apiKey: "test-key",
      model: "example/assessor",
    });
    const p = r.passages[0];
    assertEquals(p.modelStance, "supports");
    assertEquals(p.stance, "refutes");
    assertEquals(p.quote, "Ocena (Demagog): Fałsz.");
    assert(p.ratingOverride);
    assertEquals(r.ratingOverrides, 1);
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "corpus article passages and non-fact-check tiers are not cards: no rating override", async fn() {
  const official = { ...corpusCard("Fałsz"), source_id: "corpus:x:0:test", publisher: "Urząd", tier: "official" as const };
  const s = stubFetch({
    assessment: assess({ Demagog: { stance: "supports", needle: "Sprawdzane twierdzenie" }, Urząd: { stance: "supports", needle: "Sprawdzane twierdzenie" } }, "confirmed"),
  });
  try {
    const r = await assessClaim({ claim: { text: CLAIM, time: "2025", place: null }, records: [corpusArticle(), official], apiKey: "k", model: "m" });
    assertEquals(r.ratingOverrides, 0);
    assert(r.passages.every((p) => !p.ratingOverride));
  } finally {
    s.restore();
  }
} });

Deno.test("asked checker: a decisive corpus Demagog card answers 'Tak', never 'nie znaleźliśmy'", () => {
  const passage: VerifiedPassage = {
    record: corpusCard("Fałsz"),
    stance: "refutes",
    modelStance: "refutes",
    quote: "Ocena (Demagog): Fałsz.",
    quoteRejected: false,
    difference: null,
    data_period: null,
  };
  const a = askedCheckerAnswer("Demagog", [passage]);
  assert(a.found);
  assertStringIncludes(a.lead, "Tak. Demagog sprawdził to twierdzenie i ocenił je jako „Fałsz”.");
  assert(!a.lead.includes("Nie znaleźliśmy"));
  // A decisive passage from that checker's own article also means it checked the claim (no rating to quote);
  // a context-only passage does not.
  const article = askedCheckerAnswer("Demagog", [{ ...passage, record: corpusArticle() }]);
  assert(article.found);
  assertStringIncludes(article.lead, "Tak. Demagog sprawdził to twierdzenie.");
  assertEquals(askedCheckerAnswer("Demagog", [{ ...passage, stance: "context", record: corpusArticle() }]).found, false);
});

Deno.test("PII: a currency code before an amount is not an ID card; a real ID number still is", () => {
  for (const amount of ["PLN 250000", "EUR 100000", "USD 999999", "CHF 120000", "PLN250000"]) {
    const { text, redactions } = maskPii(`Dotacja wyniosła ${amount}.`);
    assertStringIncludes(text, amount);
    assert(!redactions.some((r) => r.type === "id_card"), amount);
  }
  for (const id of ["ABC 123456", "ABC123456"]) {
    const { text } = maskPii(`Mój dowód: ${id}.`);
    assert(!text.includes(id), id);
    assertStringIncludes(text, "[nr dowodu]");
  }
});

Deno.test({ ...T, name: "Eurostat: with members missing, the extremes are 'spośród N państw UE z danymi', not 'w UE'", async fn() {
  const reporting = EU_MEMBERS.filter((g) => g !== "PL").slice(0, 19).concat("PL");
  const s = stubFetch({}, {
    eurostat: (url) => {
      if (url.searchParams.get("geo") === "PL") return jsonStat([{ geo: "PL", time: "2024", value: 2.9 }]);
      const t = url.searchParams.get("time")!;
      return jsonStat(reporting.map((geo, i) => ({ geo, time: t, value: geo === "PL" ? 2.9 : 3 + i })));
    },
  });
  try {
    const ctx = { signal: new AbortController().signal } as ConnectorContext;
    const claim = { text: "Bezrobocie w Polsce w 2024 r. wyniosło 2,9%.", indicator: "unemployment_rate", geo: "PL", time: "2024" };
    const [rec] = await eurostat.search(claim as unknown as Parameters<typeof eurostat.search>[0], ctx);
    assertStringIncludes(rec.text, "Najniższa wartość spośród 20 państw UE z danymi w 2024:");
    assert(!rec.text.includes("Najniższa wartość w UE"));
  } finally {
    s.restore();
  }
} });
