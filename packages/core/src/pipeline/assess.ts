/** LLM call #2 (one per claim) plus the verbatim quote check (prompts/evidence-assessment.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import type { SourceRecord } from "../connectors/types.ts";
import { containsVerbatim } from "../guard/normalize.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { evidenceAssessmentSystem } from "../prompts/evidence-assessment.v5.ts";
import type { Stance } from "../types.ts";
import { factcheckFields, isFactcheckCard, oppositePolarity, ratingStance } from "./factcheck.ts";

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
  claim: { text: string; time: string; place: string | null; entities?: string[] };
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
    // quoted only from it means the model read the statement instead of the rating: the rating decides,
    // but only when it can be applied: a known rating, and a checked statement that is not the
    // negation of the user's claim. Otherwise the card is context (abstain), never an inverted verdict.
    if (ok && isFactcheckCard(record) && DECISIVE.includes(verified.stance)) {
      const f = factcheckFields(record.text);
      // Quoting the rating line itself with another stance ("Ocena: Częściowa prawda" read as supports,
      // "Ocena: Fałsz" read as misleading): the rating's own stance applies.
      const fromHeader = (f.claimLine && containsVerbatim(f.claimLine, p.quote)) ||
        (f.ratingLine && containsVerbatim(f.ratingLine, p.quote) && f.rating && ratingStance(f.rating) !== verified.stance);
      if (f.claimLine && f.ratingLine && fromHeader) {
        const fromRating = f.rating ? ratingStance(f.rating) : null;
        const statement = f.claimLine.replace(/^Sprawdzane twierdzenie:\s*/, "");
        if (!fromRating || oppositePolarity(args.claim.text, statement)) {
          verified.stance = "context";
        } else {
          ratingOverrides++;
          verified.stance = fromRating;
          verified.quote = f.ratingLine;
          verified.ratingOverride = true;
          if (fromRating === "misleading" && !verified.difference) verified.difference = `ocena weryfikatora: ${f.rating}`;
        }
      }
    }
    // Announced is not happened (evidence-assessment rule, enforced here because models skip it):
    // a passage that only announces or schedules an event cannot confirm a claim that it took place.
    // The quote, the text right around it and other chunks of the same document count: a notice says
    // "X was announced for Monday. X is nationwide.", and the second sentence alone reads like support.
    if (verified.stance === "supports" && !ANNOUNCED.test(args.claim.text)) {
      const siblings = args.records.filter((r) => r !== record && r.url === record.url).map((r) => r.text).join("\n");
      if (ANNOUNCED.test(around(record.text, verified.quote)) || ANNOUNCED.test(siblings)) verified.stance = "context";
    }
    // A local claim is decided only by a passage about that place: a refutation about another city
    // never settles a claim about this one. Official data records (routed by country) and acts of
    // law (national) are exempt, and so are country-wide places.
    if (DECISIVE.includes(verified.stance) && !record.data && record.route !== "sejm_eli" && !aboutPlace(args.claim.place, record.text)) {
      verified.stance = "context";
    }
    // A refutation or "misleading" reading must be about the claim's subject: a passage that names
    // none of the claim's entities (another law, another product) cannot make it false.
    if ((verified.stance === "refutes" || verified.stance === "misleading") && !record.data &&
      !aboutSubject(args.claim.entities ?? [], record.text)) {
      verified.stance = "context";
    }
    return verified;
  });
  return { passages, assessment: data, usage, ratingOverrides };
}

const DECISIVE: Stance[] = ["supports", "refutes", "misleading"];
const COUNTRY_WIDE = /^(polsk|pl$|rp$|rzeczpospolit|kraj|ue$|uni|europ|świat|swiat|internet)/i;
const foldPl = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
/** True when the claim names no specific place, or the passage mentions it (5-letter stems absorb Polish case endings). */
function aboutPlace(place: string | null | undefined, text: string): boolean {
  const words = (place ?? "").split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !COUNTRY_WIDE.test(w));
  if (!words.length || COUNTRY_WIDE.test((place ?? "").trim())) return true;
  const t = foldPl(text);
  return words.some((w) => t.includes(foldPl(w).slice(0, 5)));
}

/** True when the claim lists no usable entity, or the passage names one (5-letter stems of its longer words). */
function aboutSubject(entities: string[], text: string): boolean {
  const words = entities.flatMap((e) => e.split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length >= 5 && !COUNTRY_WIDE.test(w));
  if (!words.length) return true;
  const t = foldPl(text);
  return words.some((w) => t.includes(foldPl(w).slice(0, 5)));
}

/** The quote with up to 200 characters on each side (the quote alone when it is not found). */
function around(text: string, quote: string): string {
  const i = text.indexOf(quote);
  return i < 0 ? quote : text.slice(Math.max(0, i - 200), i + quote.length + 200);
}
const ANNOUNCED =
  /\b(?:zapowiedzia\p{L}*|zapowiada\p{L}*|zaplanowan\p{L}*|ma się odbyć|mają się odbyć|odbędzie się|odbędą się|announced|scheduled|will take place)/iu;
