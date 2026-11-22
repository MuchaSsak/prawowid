/**
 * Code rules for fact-check cards (connectors/google-factcheck.ts and scripts/build_corpus_index.ts
 * write them in the same labelled shape):
 * - the checked statement is never evidence: a decisive stance quoted from it is replaced by the
 *   stance of the fact-checker's rating (evidence-assessment@4 says the same to the model);
 * - "Did <fact-checker> check X?" is answered from a fact-check by that publisher (prompt rule 7).
 */
import type { SourceRecord } from "../connectors/types.ts";
import { ARTICLE_LABEL } from "../connectors/google-factcheck.ts";
import type { Stance } from "../types.ts";

export interface FactcheckFields {
  /** The line holding the checked statement. */
  claimLine: string | null;
  /** The "Ocena (publisher): …" line, verbatim. */
  ratingLine: string | null;
  rating: string | null;
}

/** Fields come only from the card header: an appended article excerpt is never read as a card line. */
export function factcheckFields(text: string): FactcheckFields {
  text = text.split(ARTICLE_LABEL)[0];
  const claimLine = text.match(/^Sprawdzane twierdzenie: .*$/m)?.[0] ?? null;
  const ratingLine = text.match(/^Ocena \([^)\n]*\): .*$/m)?.[0] ?? null;
  const rating = ratingLine?.replace(/^Ocena \([^)\n]*\):\s*/, "").replace(/\.\s*$/, "").trim() || null;
  return { claimLine, ratingLine, rating: rating && rating !== "brak" ? rating : null };
}

/**
 * A fact-check card (from Google Fact Check or the indexed Demagog corpus), keyed on the record's
 * shape, not its route. Corpus article passages ("Fragment artykułu weryfikacji: …") are not cards.
 */
export function isFactcheckCard(record: Pick<SourceRecord, "route" | "tier" | "text">): boolean {
  if (record.tier !== "factcheck" && record.route !== "google_factcheck") return false;
  return factcheckFields(record.text).ratingLine !== null;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");

/**
 * Stance of a rating for the same claim. Order matters: "częściowa prawda" before "prawda",
 * "nieprawda" before "prawda", "partly false" before "false". Unknown ratings → null (no override).
 */
export function ratingStance(rating: string): Stance | null {
  const r = fold(rating);
  if (/mostly false|w wiekszosci falsz/.test(r)) return "refutes";
  if (/czesciow|manipul|brak kontekstu|brakujacy kontekst|bez kontekstu|wprowadza w blad|missing context|out of context|partly|partially|half|misleading|mixture|cherry|маніпул|без контексту/.test(r)) {
    return "misleading";
  }
  // "Przerobione zdjęcie / film": the material shown was altered, so what it purports to show is false.
  if (/falsz|nieprawd|false|fake|falso|faux|incorrect|wrong|pants on fire|fabricated|bezpodstawn|przerobion|scam|oszustw|неправда|фальш|фейк/.test(r)) {
    return "refutes";
  }
  if (/^(prawda|prawdziwe|true|correct|accurate|verdadero|vrai|правда)(?![\p{L}])/u.test(r)) return "supports";
  return null;
}

/** True when the publisher is the source the user named ("Demagoga" ~ "Demagog", "AFP" ~ "AFP Sprawdzam"). */
export function isAskedChecker(asked: string, publisher: string): boolean {
  const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const pub = words(publisher);
  // Prefix match absorbs Polish inflection ("Demagoga" ~ "Demagog").
  return words(asked).some((a) => pub.some((p) => a === p || (Math.min(a.length, p.length) >= 4 && (a.startsWith(p) || p.startsWith(a)))));
}
