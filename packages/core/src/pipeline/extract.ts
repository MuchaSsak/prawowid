/** LLM call #1 plus the code checks that follow it (prompts/claim-extraction.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { containsVerbatim, foldTyping, normalizeForMatch } from "../guard/normalize.ts";
import { claimExtractionSystem } from "../prompts/claim-extraction.v7.ts";
import { CLAIM_TYPES } from "../types.ts";
import { INDICATOR_KEYS } from "../connectors/stats-catalog.ts";

export interface Material {
  provenance: string;
  text: string;
}

export const ExtractedClaim = z.strictObject({
  id: z.string(),
  text: z.string(),
  source_span: z.string(),
  provenance: z.string(),
  class: z.enum(["fact", "opinion", "prediction"]),
  type: z.enum(CLAIM_TYPES).nullable(),
  /** The date or period as written in the material; code fills a missing year (dates.ts). */
  time_text: z.string().nullable(),
  time_direction: z.enum(["past", "future"]),
  place: z.string().nullable(),
  entities: z.array(z.string()),
  search_queries_pl: z.array(z.string()),
  search_query_en: z.string(),
  indicator: z.enum(INDICATOR_KEYS).nullable(),
  geo: z.string().nullable(),
  claimed_value: z.number().nullable(),
  currency: z.string().nullable(),
  risk: z.enum(["high", "normal"]),
  /** "Did <source> check X?": the source the user asked about; X is the claim (prompt rule 7). */
  asked_checker: z.string().nullable(),
  /** Scope taken from the surrounding material; each must quote the fragment that fixes it. */
  assumptions: z.array(z.strictObject({ text: z.string(), source_span: z.string() })),
  ambiguities: z.array(z.string()),
  why_not_verifiable: z.string().nullable(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaim>;

export const Extraction = z.strictObject({
  input_kind: z.enum(["checkable", "opinion_only", "joke_or_nonsense", "too_vague", "out_of_scope"]),
  claims: z.array(ExtractedClaim),
  implied_warnings: z.array(z.string()),
  clarification_question: z.string().nullable(),
  injection_signals: z.array(z.strictObject({ excerpt: z.string(), provenance: z.string() })),
  skipped_rhetorical: z.number().int(),
});
export type Extraction = z.infer<typeof Extraction>;

export interface ExtractionResult {
  extraction: Extraction;
  /** Claims whose source_span (or an assumption's span) was not found in the input (no invented claims). */
  rejectedSpans: string[];
  /** True when more fact claims were found than the cap. */
  capped: boolean;
  usage: LlmUsage;
}

export async function extractClaims(args: {
  material: Material[];
  userMessage: string;
  today: string;
  publishedAt: string | null;
  apiKey?: string;
  model: string;
  signal?: AbortSignal;
}): Promise<ExtractionResult> {
  const { data, usage } = await chatJson({
    apiKey: args.apiKey,
    model: args.model,
    system: claimExtractionSystem("Polish"),
    user: JSON.stringify({
      user_message: args.userMessage,
      material: args.material,
      material_published_at: args.publishedAt,
      today: args.today,
    }),
    schemaName: "claim_extraction",
    schema: Extraction,
    timeoutMs: LIMITS.extractionTimeoutMs,
    maxTokens: 4000,
    signal: args.signal,
  });

  const corpus = [args.userMessage, ...args.material.map((m) => m.text)].join("\n");
  const lower = (s: string) => foldTyping(s);
  const normCorpus = lower(corpus);
  const rejectedSpans: string[] = [];
  // The words must all be there; only capitalisation and Polish letters may differ (guard/normalize.ts).
  const verbatim = (span: string) => containsVerbatim(corpus, span, { ignoreCase: true });
  const kept = data.claims.filter((c) => {
    if (!verbatim(c.source_span)) {
      rejectedSpans.push(c.source_span.slice(0, 200));
      return false;
    }
    // An unsupported scope resolution counts as an invented claim: drop the claim.
    const bad = c.assumptions.find((a) => !verbatim(a.source_span));
    if (bad) {
      rejectedSpans.push(bad.source_span.slice(0, 200));
      return false;
    }
    return true;
  });
  // Hard constraint 21: the same words cannot be both an opinion and a fact. When the model files a
  // sentence as an opinion ("Rząd kłamie w sprawie X") and also rewrites it into a neutral "fact" with
  // the very same span ("Rząd przedstawia informacje o X"), the opinion wins. A fact that states a
  // number keeps its place: that figure is the checkable core ("…podniósł VAT do 25%").
  const opinionSpans = new Set(kept.filter((c) => c.class !== "fact").map((c) => lower(c.source_span).replace(/[.!?]+$/, "")));
  const paraphrases = kept.filter((c) =>
    c.class === "fact" && !/\d/.test(c.text) && opinionSpans.has(lower(c.source_span).replace(/[.!?]+$/, ""))
  );
  for (const c of paraphrases) rejectedSpans.push(c.source_span.slice(0, 200));
  if (paraphrases.length) kept.splice(0, kept.length, ...kept.filter((c) => !paraphrases.includes(c)));

  // Span order, then cap fact claims: high risk first, then original order.
  const pos = (c: ExtractedClaim) => {
    const i = normCorpus.indexOf(lower(c.source_span));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  kept.sort((a, b) => pos(a) - pos(b));
  const facts = kept.filter((c) => c.class === "fact");
  const capped = facts.length > LIMITS.maxFactClaims;
  const keepFacts = new Set(
    [...facts].sort((a, b) => (a.risk === b.risk ? 0 : a.risk === "high" ? -1 : 1)).slice(0, LIMITS.maxFactClaims),
  );
  const claims = kept
    .filter((c) => c.class !== "fact" || keepFacts.has(c))
    .slice(0, LIMITS.maxFactClaims + 6)
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));

  // Only opinion paraphrases were facts: the input is opinion-only (one-liners), not a failed extraction.
  const inputKind = paraphrases.length && data.input_kind === "checkable" && !claims.some((c) => c.class === "fact") &&
      claims.some((c) => c.class !== "fact")
    ? "opinion_only" as const
    : data.input_kind;
  return { extraction: { ...data, input_kind: inputKind, claims }, rejectedSpans, capped, usage };
}
