/**
 * Code rules for fact-check passages (connectors/google-factcheck.ts writes them):
 * - the checked statement is never evidence: a decisive stance quoted from it is replaced by the
 *   stance of the fact-checker's rating (evidence-assessment@4 says the same to the model);
 * - "Did <fact-checker> check X?" is answered from a fact-check by that publisher (prompt rule 7).
 */
import type { Stance } from "../types.ts";

export interface FactcheckFields {
  /** The line holding the checked statement. */
  claimLine: string | null;
  /** The "Ocena (publisher): …" line, verbatim. */
  ratingLine: string | null;
  rating: string | null;
}

export function factcheckFields(text: string): FactcheckFields {
  const claimLine = text.match(/^Sprawdzane twierdzenie: .*$/m)?.[0] ?? null;
  const ratingLine = text.match(/^Ocena \([^)\n]*\): .*$/m)?.[0] ?? null;
  const rating = ratingLine?.replace(/^Ocena \([^)\n]*\):\s*/, "").replace(/\.\s*$/, "").trim() || null;
  return { claimLine, ratingLine, rating: rating && rating !== "brak" ? rating : null };
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");

/**
 * Stance of a rating for the same claim. Order matters: "częściowa prawda" before "prawda",
 * "nieprawda" before "prawda", "partly false" before "false". Unknown ratings → null (no override).
 */
export function ratingStance(rating: string): Stance | null {
  const r = fold(rating);
  if (/mostly false|w wiekszosci falsz/.test(r)) return "refutes";
  if (/czesciow|manipul|brak kontekstu|bez kontekstu|wprowadza w blad|missing context|out of context|partly|partially|half|misleading|mixture|cherry/.test(r)) {
    return "misleading";
  }
  if (/falsz|nieprawd|false|fake|falso|faux|incorrect|wrong|pants on fire|fabricated|bezpodstawn/.test(r)) return "refutes";
  if (/^(prawda|prawdziwe|true|correct|accurate|verdadero|vrai)\b/.test(r)) return "supports";
  return null;
}

/** True when the publisher is the source the user named ("Demagoga" ~ "Demagog", "AFP" ~ "AFP Sprawdzam"). */
export function isAskedChecker(asked: string, publisher: string): boolean {
  const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const pub = words(publisher);
  // Prefix match absorbs Polish inflection ("Demagoga" ~ "Demagog").
  return words(asked).some((a) => pub.some((p) => a === p || (Math.min(a.length, p.length) >= 4 && (a.startsWith(p) || p.startsWith(a)))));
}
