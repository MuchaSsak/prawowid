/** LLM call #2 (one per claim) plus the verbatim quote check (prompts/evidence-assessment.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import type { SourceRecord } from "../connectors/types.ts";
import { containsVerbatim } from "../guard/normalize.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { evidenceAssessmentSystem } from "../prompts/evidence-assessment.v4.ts";
import type { Stance } from "../types.ts";
import { factcheckFields, ratingStance } from "./factcheck.ts";

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
  /** Is the claim, as stated, true? Code turns it into the leading "Tak."/"Nie." (render.ts leadWord). */
  plain_answer: z.enum(["yes", "no", "neither"]),
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
  /** The model quoted a fact-check's checked statement; code used the rating instead. */
  ratingOverride?: boolean;
}

export interface AssessmentResult {
  passages: VerifiedPassage[];
  assessment: Assessment;
  usage: LlmUsage;
  /** Passages whose stance code took from the fact-checker's rating; the model's verdict is then stale. */
  ratingOverrides: number;
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
  let ratingOverrides = 0;
  const passages: VerifiedPassage[] = args.records.map((record, i) => {
    const p = byId.get(ids[i]);
    if (!p) {
      return { record, stance: "irrelevant", modelStance: "irrelevant", quote: "", quoteRejected: false, difference: null, data_period: null };
    }
    const needsQuote = p.stance !== "irrelevant";
    const ok = !needsQuote || containsVerbatim(record.text, p.quote);
    const verified: VerifiedPassage = {
      record,
      stance: ok ? p.stance : "irrelevant",
      modelStance: p.stance,
      quote: p.quote,
      quoteRejected: needsQuote && !ok,
      difference: p.difference,
      data_period: p.data_period,
    };
    // A fact-check's checked statement is the claim under review, not evidence. A decisive stance
    // quoted only from it means the model read the statement instead of the rating: the rating decides.
    if (ok && record.route === "google_factcheck" && DECISIVE.includes(verified.stance)) {
      const f = factcheckFields(record.text);
      const fromRating = f.rating ? ratingStance(f.rating) : null;
      if (f.claimLine && f.ratingLine && fromRating && containsVerbatim(f.claimLine, p.quote)) {
        ratingOverrides++;
        verified.stance = fromRating;
        verified.quote = f.ratingLine;
        verified.ratingOverride = true;
        if (fromRating === "misleading" && !verified.difference) verified.difference = `ocena weryfikatora: ${f.rating}`;
      }
    }
    return verified;
  });
  return { passages, assessment: data, usage, ratingOverrides };
}

const DECISIVE: Stance[] = ["supports", "refutes", "misleading"];
