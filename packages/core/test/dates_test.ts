/** Unit tests for dates without a year and the reference date (pipeline §2). Synthetic data only. */
import { assertEquals } from "jsr:@std/assert@^1";
import { MemoryCorpusStore } from "../src/mod.ts";
import { parsePeriod } from "../src/connectors/stats-catalog.ts";
import {
  distinctiveSentences,
  findOriginalDate,
  periodNote,
  type ReferenceDate,
  referenceDate,
  resolveTime,
} from "../src/pipeline/dates.ts";

const ref = (date: string, source: ReferenceDate["source"] = "publication"): ReferenceDate => ({ date, source });

Deno.test("day and month: the latest such date on or before the reference date", () => {
  assertEquals(resolveTime("16 listopada", "past", ref("2026-11-21")), { time: "2026-11-16", filledYear: true });
  assertEquals(resolveTime("16 listopada", "past", ref("2027-01-10")), { time: "2026-11-16", filledYear: true });
  assertEquals(resolveTime("21 listopada", "past", ref("2026-11-21")), { time: "2026-11-21", filledYear: true });
  assertEquals(resolveTime("16.11", "past", ref("2026-11-21")), { time: "2026-11-16", filledYear: true });
});

Deno.test("future direction: the nearest such date on or after the reference date", () => {
  assertEquals(resolveTime("15 marca", "future", ref("2027-01-10")), { time: "2027-03-15", filledYear: true });
  assertEquals(resolveTime("15 marca", "future", ref("2026-11-21")), { time: "2027-03-15", filledYear: true });
  assertEquals(resolveTime("21 listopada", "future", ref("2026-11-21")), { time: "2026-11-21", filledYear: true });
});

Deno.test("month alone (locative and nominative forms)", () => {
  assertEquals(resolveTime("w listopadzie", "past", ref("2026-11-21")), { time: "2026-11", filledYear: true });
  assertEquals(resolveTime("w grudniu", "past", ref("2026-11-21")), { time: "2025-12", filledYear: true });
  assertEquals(resolveTime("maj", "future", ref("2026-11-21")), { time: "2027-05", filledYear: true });
});

Deno.test("29 February goes to the nearest leap year in the right direction", () => {
  assertEquals(resolveTime("29 lutego", "past", ref("2026-11-21")), { time: "2024-02-29", filledYear: true });
  assertEquals(resolveTime("29 lutego", "future", ref("2026-11-21")), { time: "2028-02-29", filledYear: true });
});

Deno.test("a stated year is normalized to the ISO-like form the statistics connectors read", () => {
  assertEquals(resolveTime("16 listopada 2024", "past", ref("2026-11-21")), { time: "2024-11-16", filledYear: false });
  assertEquals(resolveTime("16.11.2024", "past", ref("2026-11-21")), { time: "2024-11-16", filledYear: false });
  assertEquals(resolveTime("w listopadzie 2024", "past", ref("2026-11-21")), { time: "2024-11", filledYear: false });
  assertEquals(resolveTime("2024", "past", ref("2026-11-21")), { time: "2024", filledYear: false });
  assertEquals(resolveTime("2025-06", "past", ref("2026-11-21")), { time: "2025-06", filledYear: false });
  // Other text with a year (a range, "w 2024 roku") is left for parsePeriod.
  assertEquals(resolveTime("2020-2024", "past", ref("2026-11-21")), { time: "2020-2024", filledYear: false });
  assertEquals(resolveTime("w 2024 roku", "past", ref("2026-11-21")), { time: "w 2024 roku", filledYear: false });
});

Deno.test("relative words are resolved against the reference date and marked", () => {
  assertEquals(resolveTime("wczoraj", "past", ref("2026-11-21")), { time: "2026-11-20", filledYear: true, relative: "wczoraj" });
  assertEquals(resolveTime("przedwczoraj", "past", ref("2026-03-01")), { time: "2026-02-27", filledYear: true, relative: "przedwczoraj" });
  assertEquals(resolveTime("dziś", "past", ref("2026-11-21")), { time: "2026-11-21", filledYear: true, relative: "dziś" });
  assertEquals(resolveTime("w zeszłym roku", "past", ref("2026-11-21")), { time: "2025", filledYear: true, relative: "w zeszłym roku" });
  assertEquals(resolveTime("w tym roku", "past", ref("2026-11-21")), { time: "2026", filledYear: true, relative: "w tym roku" });
  assertEquals(resolveTime("w ubiegłym miesiącu", "past", ref("2026-01-05")), { time: "2025-12", filledYear: true, relative: "w ubiegłym miesiącu" });
  assertEquals(
    periodNote({ time: "2026-11-20", filledYear: true, relative: "wczoraj" }, ref("2026-11-21")),
    "Tekst podaje czas względnie („wczoraj”); przyjęliśmy 20.11.2026 na podstawie daty publikacji (21.11.2026).",
  );
});

Deno.test("no date or an unparsed period passes through without a filled year", () => {
  assertEquals(resolveTime("w czasie pandemii", "past", ref("2026-11-21")), { time: "w czasie pandemii", filledYear: false });
  assertEquals(resolveTime(null, "past", ref("2026-11-21")), { time: "unknown", filledYear: false });
  assertEquals(resolveTime("unknown", "past", ref("2026-11-21")), { time: "unknown", filledYear: false });
});

Deno.test("the user-facing note names the basis of the year", () => {
  const filled = { time: "2026-11-16", filledYear: true };
  assertEquals(
    periodNote(filled, ref("2026-11-21")),
    "Tekst nie podaje roku; przyjęliśmy 2026 na podstawie daty publikacji (21.11.2026).",
  );
  assertEquals(
    periodNote(filled, ref("2026-11-21", "submission")),
    "Tekst nie podaje roku; przyjęliśmy 2026 na podstawie daty zgłoszenia (21.11.2026); jeśli tekst jest starszy, wynik może być inny.",
  );
  assertEquals(periodNote({ time: "2024", filledYear: false }, ref("2026-11-21")), null);
});

const SENTENCE = "Rada Miasta Przykładowo zdecydowała, że od przyszłego miesiąca wszystkie autobusy będą jeździć co dziesięć minut.";

function record(text: string, published_at: string | null, id = "doc:1") {
  return {
    source_id: id,
    route: "corpus",
    title: "Komunikat (test)",
    publisher: "Urząd Miasta Przykładowo (test)",
    url: `https://example.org/${id}`,
    published_at,
    retrieved_at: "2026-11-21T00:00:00Z",
    tier: "official" as const,
    origin_key: id,
    text,
  };
}

Deno.test("distinctive sentences: long enough, longest first", () => {
  const out = distinctiveSentences(`Krótkie zdanie. ${SENTENCE} Inne krótkie.`);
  assertEquals(out, [SENTENCE]);
});

Deno.test("original found in the corpus: the earliest verbatim match is the reference date", async () => {
  const corpus = new MemoryCorpusStore();
  await corpus.upsert([
    record(`Wstęp. ${SENTENCE} Dalszy ciąg.`, "2025-03-10T08:00:00Z", "doc:1"),
    record(`Przedruk: ${SENTENCE}`, "2025-03-12", "doc:2"),
    record("Inny tekst o autobusach w Przykładowie, bez tego zdania.", "2024-01-01", "doc:3"),
  ]);
  assertEquals(await findOriginalDate([`Wklejony fragment. ${SENTENCE}`], corpus, "2026-11-21"), "2025-03-10");
  assertEquals(
    await referenceDate({ publishedAt: null, texts: [SENTENCE], corpus, today: "2026-11-21" }),
    { date: "2025-03-10", source: "original" },
  );
});

Deno.test("reference date: publication first; empty corpus or no match → submission date", async () => {
  const empty = new MemoryCorpusStore();
  assertEquals(
    await referenceDate({ publishedAt: "2025-05-01T10:00:00Z", texts: [SENTENCE], corpus: empty, today: "2026-11-21" }),
    { date: "2025-05-01", source: "publication" },
  );
  assertEquals(
    await referenceDate({ publishedAt: null, texts: [SENTENCE], corpus: empty, today: "2026-11-21" }),
    { date: "2026-11-21", source: "submission" },
  );
  const other = new MemoryCorpusStore();
  await other.upsert([record("Rada Miasta Przykładowo zdecydowała o czymś zupełnie innym w sprawie autobusów.", "2025-01-01")]);
  assertEquals(
    await referenceDate({ publishedAt: null, texts: [SENTENCE], corpus: other, today: "2026-11-21" }),
    { date: "2026-11-21", source: "submission" },
  );
});

Deno.test("'ostatnio' / 'niedawno' → the last 30 days before the reference date, read by parsePeriod as its end", () => {
  const r = resolveTime("ostatnio", "past", ref("2026-11-21"));
  assertEquals(r, { time: "2026-10-22/2026-11-21", filledYear: true, relative: "ostatnio" });
  assertEquals(resolveTime("niedawno", "past", ref("2026-11-21")).time, "2026-10-22/2026-11-21");
  assertEquals(parsePeriod(r.time), { year: 2026, month: 11, day: null });
  assertEquals(
    periodNote(r, ref("2026-11-21", "submission")),
    "Tekst podaje czas względnie („ostatnio”); przyjęliśmy okres 22.10.2026–21.11.2026 na podstawie daty zgłoszenia (21.11.2026); jeśli tekst jest starszy, wynik może być inny.",
  );
});


Deno.test("'w tym tygodniu' / 'w zeszłym tygodniu' → Monday-to-Sunday weeks, this week ending at the reference date", () => {
  // 2026-11-22 is a Sunday, 2026-11-18 a Wednesday, 2026-11-16 a Monday.
  assertEquals(resolveTime("w tym tygodniu", "past", ref("2026-11-22")), { time: "2026-11-16/2026-11-22", filledYear: true, relative: "w tym tygodniu" });
  assertEquals(resolveTime("ten tydzień", "past", ref("2026-11-18")).time, "2026-11-16/2026-11-18");
  assertEquals(resolveTime("tego tygodnia", "past", ref("2026-11-16")).time, "2026-11-16/2026-11-16");
  assertEquals(resolveTime("w zeszłym tygodniu", "past", ref("2026-11-18")).time, "2026-11-09/2026-11-15");
  assertEquals(resolveTime("ubiegły tydzień", "past", ref("2026-11-22")).time, "2026-11-09/2026-11-15");
  assertEquals(
    periodNote(resolveTime("w tym tygodniu", "past", ref("2026-11-22")), ref("2026-11-22", "submission")),
    "Tekst podaje czas względnie („w tym tygodniu”); przyjęliśmy okres 16.11.2026–22.11.2026 na podstawie daty zgłoszenia (22.11.2026); jeśli tekst jest starszy, wynik może być inny.",
  );
});
