/** LLM call #2 (one per claim) plus the verbatim quote check (prompts/evidence-assessment.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import type { SourceRecord } from "../connectors/types.ts";
import { containsVerbatim } from "../guard/normalize.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { evidenceAssessmentSystem } from "../prompts/evidence-assessment.v2.ts";
import type { Stance } from "../types.ts";

export const Assessment = z.strictObject({
  passages: z.array(z.strictObject({
    passage_id: z.string(),
    stance: z.enum(["supports", "refutes", "misleading", "context", "irrelevant"]),
    quote: z.string(),
    difference: z.string().nullable(),
    data_period: z.string().nullable(),
  })),
  proposed_verdict: z.enum(["confirmed", "false", "misleading", "insufficient_evidence"]),
  explanation: z.string(),
  missing: z.string().nullable(),
  injection_signals: z.array(z.strictObject({ excerpt: z.string(), passage_id: z.string() })),
});
export type Assessment = z.infer<typeof Assessment>;

export interface VerifiedPassage {
  record: SourceRecord;
  /** Stance after the quote check: a failed quote makes it "irrelevant". */
  stance: Stance;
  modelStance: Stance;
  quote: string;
  quoteRejected: boolean;
  difference: string | null;
  data_period: string | null;
}

export interface AssessmentResult {
  passages: VerifiedPassage[];
  assessment: Assessment;
  usage: LlmUsage;
}

export async function assessClaim(args: {
  claim: { text: string; time: string; place: string | null };
  records: SourceRecord[];
  apiKey?: string;
  model: string;
  fallbackModel?: string;
  signal?: AbortSignal;
}): Promise<AssessmentResult> {
  const ids = args.records.map((_, i) => `p${i + 1}`);
  const { data, usage } = await chatJson({
    apiKey: args.apiKey,
    model: args.model,
    fallbackModel: args.fallbackModel,
    system: evidenceAssessmentSystem("Polish"),
    // No URLs or titles go to the model: it cannot copy or invent them. Code adds them later.
    user: JSON.stringify({
      claim: args.claim,
      passages: args.records.map((r, i) => ({
        passage_id: ids[i],
        publisher: r.publisher,
        published_at: r.published_at,
        source_tier: r.tier,
        text: r.text,
      })),
    }),
    schemaName: "evidence_assessment",
    schema: Assessment,
    timeoutMs: LIMITS.assessmentTimeoutMs,
    maxTokens: 2500,
    signal: args.signal,
  });

  const byId = new Map(data.passages.map((p) => [p.passage_id, p]));
  const passages: VerifiedPassage[] = args.records.map((record, i) => {
    const p = byId.get(ids[i]);
    if (!p) {
      return { record, stance: "irrelevant", modelStance: "irrelevant", quote: "", quoteRejected: false, difference: null, data_period: null };
    }
    const needsQuote = p.stance !== "irrelevant";
    const ok = !needsQuote || containsVerbatim(record.text, p.quote);
    return {
      record,
      stance: ok ? p.stance : "irrelevant",
      modelStance: p.stance,
      quote: p.quote,
      quoteRejected: needsQuote && !ok,
      difference: p.difference,
      data_period: p.data_period,
    };
  });
  return { passages, assessment: data, usage };
}
