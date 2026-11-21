/** LLM call #1 plus the code checks that follow it (prompts/claim-extraction.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { containsVerbatim, normalizeForMatch } from "../guard/normalize.ts";
import { claimExtractionSystem } from "../prompts/claim-extraction.v1.ts";
import { CLAIM_TYPES } from "../types.ts";

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
  time: z.string(),
  place: z.string().nullable(),
  entities: z.array(z.string()),
  search_queries_pl: z.array(z.string()),
  search_query_en: z.string(),
  risk: z.enum(["high", "normal"]),
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
  /** Claims whose source_span was not found in the input (the model may not invent claims). */
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
  const normCorpus = normalizeForMatch(corpus);
  const rejectedSpans: string[] = [];
  const kept = data.claims.filter((c) => {
    if (containsVerbatim(corpus, c.source_span)) return true;
    rejectedSpans.push(c.source_span.slice(0, 200));
    return false;
  });

  // Span order, then cap fact claims: high risk first, then original order.
  const pos = (c: ExtractedClaim) => {
    const i = normCorpus.indexOf(normalizeForMatch(c.source_span));
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

  return { extraction: { ...data, claims }, rejectedSpans, capped, usage };
}
