/**
 * Keyword relevance shared by the live matcher and the in-memory store. Conservative on purpose:
 * a wrong "known disinformation" note next to a true claim would mislead, so a weak overlap is dropped.
 * Replaced by hybrid scores (FTS + embeddings, RRF) in the Supabase store.
 */
import type { ClaimQuery } from "../connectors/types.ts";
import { tokens } from "../guard/normalize.ts";

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "will", "has", "have", "had",
  "not", "but", "its", "his", "her", "their", "they", "into", "about", "over", "after", "than", "been",
  "who", "what", "when", "which", "said", "says", "new", "all", "one", "two", "more", "most",
]);

/** Distinctive words of the claim: the English query plus named entities. */
export function queryTerms(claim: ClaimQuery): Set<string> {
  return new Set(tokens([claim.search_query_en, ...claim.entities].join(" ")).filter((t) => !STOP.has(t)));
}

export const MIN_OVERLAP = 2;
export const MIN_SCORE = 0.5;

/** Share of the claim's terms found in the record (title + start of the text), 0..1. */
export function overlapScore(terms: Set<string>, recordText: string): { score: number; overlap: number } {
  if (terms.size === 0) return { score: 0, overlap: 0 };
  const have = new Set(tokens(recordText));
  let overlap = 0;
  for (const t of terms) {
    // Light stemming for English plurals and verb forms ("troops"/"troop", "sends"/"send").
    if (have.has(t) || have.has(t.replace(/(es|s|ed|ing)$/, "")) || ["s", "es", "ed"].some((x) => have.has(t + x))) overlap++;
  }
  return { score: overlap / terms.size, overlap };
}

export function relevant(r: { score: number; overlap: number }): boolean {
  return r.overlap >= MIN_OVERLAP && r.score >= MIN_SCORE;
}
