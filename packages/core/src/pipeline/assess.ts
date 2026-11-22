/** LLM call #2 (one per claim) plus the verbatim quote check (prompts/evidence-assessment.md). */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import type { SourceRecord } from "../connectors/types.ts";
import { containsVerbatim } from "../guard/normalize.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { eventDateIn } from "./dates.ts";
import { evidenceAssessmentSystem } from "../prompts/evidence-assessment.v7.ts";
import type { Stance } from "../types.ts";
import { factcheckFields, isFactcheckCard, oppositePolarity, ratingStance } from "./factcheck.ts";

export const Assessment = z.strictObject({
  passages: z.array(z.strictObject({
    passage_id: z.string(),
    stance: z.enum(["supports", "refutes", "misleading", "context", "irrelevant"]),
    quote: z.string(),
    difference: z.string().nullable(),
    data_period: z.string().nullable(),
    /** The passage announces or schedules exactly the event the claim says took place (prompt v7). */
    announces_claimed_event: z.boolean(),
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
  /**
   * Set when the announced-is-not-happened guard turned a "supports" into "context": the sentence of
   * the same document that announces the event, verbatim. The answer states it (announced, outcome unknown).
   */
  announcement?: string;
  /**
   * Decision 016: an official source announced exactly this event for this day, the day is before the
   * reference date and the source mentions no cancellation, so the announcement supports the claim.
   * The answer says it rests on the announcement and the strength is low.
   */
  announcedPassed?: string;
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
  /** YYYY-MM-DD the claim is read from (pipeline/dates.ts referenceDate); enables the decision-016 rule. */
  referenceDate?: string;
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
      // The rating line quoted as the decisive sentence of a card whose checked statement has the
      // opposite polarity ("5G nie ma związku z COVID-19" vs a "Fałsz" on "…odkryli, że Covid-19 to …"):
      // the rating cannot be applied as it stands, so the card is context (live probe, 2026-11-22).
      const ratingQuoted = f.ratingLine && containsVerbatim(f.ratingLine, p.quote);
      if (ratingQuoted && f.claimLine && !fromHeader &&
        oppositePolarity(args.claim.text, f.claimLine.replace(/^Sprawdzane twierdzenie:\s*/, ""))) {
        verified.stance = "context";
      }
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
      const near = around(record.text, verified.quote);
      if (ANNOUNCED.test(near) || ANNOUNCED.test(siblings)) {
        verified.stance = "context";
        const sentence = ANNOUNCED.test(near)
          ? announcingSentence(record.text, Math.max(0, record.text.indexOf(verified.quote)), args.claim.text, args.claim.place)
          : announcingSentence(siblings, 0, args.claim.text, args.claim.place);
        if (sentence) verified.announcement = sentence;
      }
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
    // Decision 016 (user, 2026-11-22): an official announcement of exactly this event, for a day that
    // has already passed, with no cancellation in the same document, supports a claim that it took place.
    if (ok && verified.stance === "context" && p.announces_claimed_event && args.referenceDate) {
      const day = announcedDayPassed(record, args.records, verified.quote, args.claim, args.referenceDate);
      if (day) {
        verified.stance = "supports";
        verified.announcedPassed = day.date;
        verified.announcement = day.sentence;
        // The citation shows the announcing sentence (verbatim from the same page), not the neighbour quoted.
        verified.quote = day.sentence;
      }
    }
    return verified;
  });
  return { passages, assessment: data, usage, ratingOverrides };
}

const DECISIVE: Stance[] = ["supports", "refutes", "misleading"];
const CANCELLED =
  /(odwoła\p{L}*|odwołan\p{L}*|przełożon\p{L}*|przełoż\p{L}*|przesunięt\p{L}*|zawieszon\p{L}*|anulowan\p{L}*|cancel\p{L}*|postpon\p{L}*|revoked|annullat\p{L}*|revocat\p{L}*|rinviat\p{L}*|sospes\p{L}*)/iu;

/** Is the claim's time ("YYYY", "YYYY-MM", "YYYY-MM-DD", "start/end", "unknown") compatible with this day? */
function dayInClaimTime(day: string, time: string): boolean {
  const interval = time.match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
  if (interval) return day >= interval[1] && day <= interval[2];
  if (/^\d{4}(-\d{2}){0,2}$/.test(time)) return day.startsWith(time);
  return true; // "unknown" or unparsed text: the model's same-event check stands alone
}

/**
 * Decision 016 conditions, all required: an official-tier record about the claim's place, a claim that
 * the event took place (not that it was announced), one announcing sentence naming a single day, that
 * day inside the claim's time and before the reference date, and no cancellation or postponement
 * anywhere in the same document.
 */
function announcedDayPassed(
  record: SourceRecord,
  records: SourceRecord[],
  quote: string,
  claim: { text: string; time: string; place: string | null },
  referenceDate: string,
): { date: string; sentence: string } | null {
  if (record.tier !== "official" || ANNOUNCED.test(claim.text) || !record.published_at) return null;
  // The title counts too: a country page is titled with the country ("Włochy") while its text may only
  // use an inflected form whose stem differs ("we Włoszech").
  if (!aboutPlace(claim.place, `${record.title}\n${record.text}`)) return null;
  const document = [record, ...records.filter((r) => r !== record && r.url === record.url)].map((r) => r.text).join("\n");
  // A cancellation counts only in a sentence about the claim's subject: "Strajk został odwołany" blocks,
  // "odwołane mogą być zaplanowane zabiegi" (a consequence of the strike) does not.
  if (sentencesOf(document).some((s) => CANCELLED.test(s) && sharesSubject(claim.text, s, claim.place))) return null;
  // The model's quote may be a neighbouring sentence ("Konsekwencje strajku są trudne do przewidzenia"),
  // and the corpus splits a page into chunks: take the nearest announcing sentence of this chunk, then
  // of the other chunks of the same page, that is about the claim's subject and names a qualifying day.
  const siblings = records.filter((r) => r !== record && r.url === record.url).map((r) => r.text).join("\n");
  const candidates = [...announcingSentences(record.text, Math.max(0, record.text.indexOf(quote))), ...announcingSentences(siblings, 0)];
  for (const sentence of candidates) {
    if (!sharesSubject(claim.text, sentence, claim.place)) continue;
    const date = eventDateIn(sentence, record.published_at);
    if (date && date < referenceDate.slice(0, 10) && dayInClaimTime(date, claim.time)) return { date, sentence };
  }
  return null;
}
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
/**
 * Whole sentences that announce or schedule something, verbatim, nearest to `at` first. A sentence
 * ends at . ! ? before a capital letter, a digit ("…poniżej. 11 listopada…") or the end, so
 * "20.11. zapowiedziano" stays one sentence.
 */
const SENTENCE = /(?:[^\n.!?]|[.!?](?!\s+[\p{Lu}\d]|\s*$))+[.!?]?/gu;
function announcingSentences(text: string, at: number): string[] {
  const found: { s: string; d: number }[] = [];
  for (const m of text.matchAll(SENTENCE)) {
    const sentence = m[0].trim();
    if (sentence.length > 10 && ANNOUNCED.test(sentence)) found.push({ s: sentence, d: Math.abs(m.index! - at) });
  }
  return found.sort((a, b) => a.d - b.d).map((x) => x.s);
}
const sentencesOf = (text: string) => [...text.matchAll(SENTENCE)].map((m) => m[0].trim()).filter(Boolean);

/** The announcing sentence about the claim's subject nearest to `at`, else the nearest one (null when none). */
function announcingSentence(text: string, at: number, claimText = "", place: string | null = null): string | null {
  const all = announcingSentences(text, at);
  return all.find((s) => sharesSubject(claimText, s, place)) ?? all[0] ?? null;
}

// Words of a claim that say when or that something happened, not what: never a subject match.
const NOT_SUBJECT = /^(odby\p{L}*|ostatni\p{L}*|niedawn\p{L}*|tygodni\p{L}*|tydzie\p{L}*|miesi\p{L}*|wczoraj|dzisiaj|przedwczoraj|kiedy\p{L}*|został\p{L}*|zostan\p{L}*|naprawd\p{L}*)$/iu;
/**
 * True when the sentence contains a 5-letter stem of a claim word that names the subject (or the claim
 * has none). Place words don't count: every sentence of a country page names the country.
 */
function sharesSubject(claimText: string, sentence: string, place: string | null = null): boolean {
  const placeStems = (place ?? "").split(/[^\p{L}]+/u).filter((w) => w.length >= 4).map((w) => foldPl(w).slice(0, 4));
  const words = claimText.split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 5 && !NOT_SUBJECT.test(w) && !placeStems.some((s) => foldPl(w).startsWith(s)));
  if (!words.length) return true;
  const t = foldPl(sentence);
  return words.some((w) => t.includes(foldPl(w).slice(0, 5)));
}
const ANNOUNCED =
  /\b(?:zapowiedzia\p{L}*|zapowiada\p{L}*|zaplanowan\p{L}*|planowan\p{L}*|planuj\p{L}*|ma się odbyć|mają się odbyć|odbędzie się|odbędą się|announced|scheduled|will take place)/iu;
