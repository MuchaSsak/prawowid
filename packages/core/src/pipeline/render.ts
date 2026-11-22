/** Polish templates for system messages and fallback explanations (response-contract.md). */
import type { ClaimSystemState, RequestStatus, SystemMessage, Verdict } from "../types.ts";
import type { VerifiedPassage } from "./assess.ts";
import { formatDatePl } from "./dates.ts";
import { factcheckFields, isAskedChecker, isFactcheckCard } from "./factcheck.ts";

export const NOT_A_VERDICT = "To nie jest ocena treści.";

export function requestMessage(status: RequestStatus, detail?: string | null): SystemMessage | null {
  switch (status) {
    case "needs_clarification":
      return { title: "Doprecyzuj twierdzenie", text: detail || "Napisz dokładniej, kto, co, kiedy i gdzie, a sprawdzimy to." };
    case "out_of_scope":
      return { title: "Poza zakresem", text: "Sprawdzamy twierdzenia o faktach. Ta prośba wykracza poza zakres usługi." };
    case "not_a_claim":
      return {
        title: "Brak twierdzenia do sprawdzenia",
        text: "Nie znaleźliśmy tu twierdzenia o faktach. Wklej wypowiedź, artykuł, link albo zrzut ekranu, a sprawdzimy zawarte w nim fakty.",
      };
    case "input_rejected":
      return { title: "Nie możemy przyjąć tych danych", text: detail || "Sprawdź format i rozmiar." };
    case "rate_limited":
      return { title: "Zbyt wiele zapytań", text: "Spróbuj ponownie za chwilę." };
    case "technical_error":
      return { title: "Nie udało się zakończyć sprawdzania", text: `${detail ? detail + " " : ""}${NOT_A_VERDICT}` };
    default:
      return null;
  }
}

export function claimStateMessage(state: ClaimSystemState, detail?: string): string {
  switch (state) {
    case "source_unavailable":
      return `Nie mogliśmy sprawdzić w wymaganym źródle${detail ? ` (${detail})` : ""}. ${NOT_A_VERDICT}`;
    case "technical_error":
      return `Wystąpił błąd techniczny podczas sprawdzania${detail ? ` (${detail})` : ""}. ${NOT_A_VERDICT}`;
    case "not_processed":
      return "Nie sprawdzono z powodu limitu czasu lub liczby twierdzeń. Spróbuj wysłać ten fragment osobno.";
  }
}

export function templateExplanation(verdict: Verdict, decisive: VerifiedPassage[]): string {
  const pubs = [...new Set(decisive.map((p) => p.record.publisher))].join(", ");
  switch (verdict) {
    case "confirmed":
      return `Źródła potwierdzają to twierdzenie (${pubs}).`;
    case "false":
      return `Źródła przeczą temu twierdzeniu (${pubs}).`;
    case "misleading": {
      const diff = decisive.find((p) => p.difference)?.difference;
      return `Fakt wyjściowy się zgadza, ale twierdzenie zmienia jego kontekst${diff ? `: ${diff}` : ""} (${pubs}).`;
    }
    case "insufficient_evidence":
      return "Nie znaleźliśmy wystarczających dowodów, by potwierdzić lub obalić to twierdzenie. Brak wyniku w przeszukanych źródłach nie oznacza, że to nieprawda.";
    case "not_verifiable":
      return "To opinia, ocena lub prognoza, a nie twierdzenie o faktach.";
  }
}

/**
 * Abstention where a source only announced the event (assess.ts announced guard): state that fact with
 * its source and the announcing sentence, then what is unknown (evidence-assessment `missing` rule).
 * Null when no passage carries an announcement.
 */
export function announcementExplanation(passages: VerifiedPassage[]): { explanation: string; missing: string } | null {
  const p = passages.find((x) => x.announcement);
  if (!p?.announcement) return null;
  const when = p.record.published_at ? `, ${formatDatePl(p.record.published_at)}` : "";
  const sentence = p.announcement.replace(/[.!?]+$/, "");
  return {
    explanation: `Źródło podaje tylko zapowiedź (${p.record.publisher}${when}): „${sentence}”. Nie znaleźliśmy źródła, które potwierdza, że to się odbyło.`,
    missing: "Nie wiemy, czy zapowiedziane wydarzenie się odbyło. Rozstrzygnęłoby to źródło opublikowane po jego terminie, np. komunikat organizatora lub relacja agencji.",
  };
}

/** Confirmed from an official announcement whose day has passed (decision 016): say what it rests on. */
export function announcedPassedExplanation(passages: VerifiedPassage[]): string {
  const p = passages.find((x) => x.announcedPassed && x.announcement)!;
  const when = p.record.published_at ? ` (${formatDatePl(p.record.published_at)})` : "";
  const sentence = p.announcement!.replace(/[.!?]+$/, "");
  return `${p.record.publisher}${when} podało: „${sentence}”. Termin (${formatDatePl(p.announcedPassed!)}) już minął, a źródło nie informuje o odwołaniu ani przełożeniu, więc przyjmujemy, że wydarzenie się odbyło. Nie mamy relacji z jego przebiegu.`;
}

/** Polish plural: 1 → one, 2-4 (not 12-14) → few, else many. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}

export function summaryText(facts: number, opinions: number): string {
  if (facts === 0 && opinions === 0) return "Nie znaleźliśmy twierdzeń do sprawdzenia.";
  const f = `${facts} ${plural(facts, "twierdzenie", "twierdzenia", "twierdzeń")} o faktach`;
  const o = `${opinions} ${plural(opinions, "opinię lub prognozę", "opinie lub prognozy", "opinii lub prognoz")}`;
  if (opinions === 0) return `Znaleźliśmy ${f}.`;
  if (facts === 0) return `Tekst zawiera ${o}, których nie da się zweryfikować źródłami.`;
  return `Znaleźliśmy ${f} i ${o}.`;
}

export const BASE_LIMITATIONS = [
  "Nie oceniamy opinii, intencji ani prognoz.",
  "Nie wykrywamy deepfake'ów i nie wyszukujemy obrazów wstecz.",
  "Prywatne imiona i nazwiska nie są jeszcze automatycznie maskowane; nie wklejaj danych osobowych.",
];

// ── Leading word (user, 2026-11-21; organizer samples A, B, E, G, J) ────────────────────────────
// "Tak."/"Nie." for a question, "To prawda."/"To nieprawda." for a statement, only when the answer is
// unambiguous: confirmed + "yes", false + "no", or misleading + "no" when the claim as stated is not
// true (old or other-place material shown as current, sample B). Partly true, a wrong conclusion
// (sample C), abstention (the Italy strike sample) and conflicts get no leading word.
export type PlainAnswer = "yes" | "no" | "neither";

const LEAD_RE = /^\s*(tak|nie|to prawda|to nieprawda)\s*[.,!:–-]\s*/i;

/** True when the user asked a question ("Czy …?", "… ?") rather than pasting a statement. */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  return /^czy(?![\p{L}])/iu.test(t) || /\?\s*$/.test(t) || /\?\s*(sprawdź|sprawdz|zobacz)/i.test(t);
}

export function leadWord(verdict: Verdict, plain: PlainAnswer, question: boolean): string | null {
  const yes = question ? "Tak." : "To prawda.";
  const no = question ? "Nie." : "To nieprawda.";
  if (verdict === "confirmed" && plain === "yes") return yes;
  if ((verdict === "false" || verdict === "misleading") && plain === "no") return no;
  return null;
}

/**
 * A fact-checker rated this claim "partly true" (or "half true", "partly false"): the answer is neither
 * yes nor no, so no leading word, whatever the model's plain answer (organizer sample C).
 */
export function ratedPartlyTrue(decisive: VerifiedPassage[]): boolean {
  return decisive.some((p) => {
    if (!isFactcheckCard(p.record)) return false;
    const r = (factcheckFields(p.record.text).rating ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return /czesciow|partly|partially|half|mixture/.test(r);
  });
}

/** Every abstention says that no result is not a refutation (organizer sample D). */
export const ABSENCE_NOTE = "Brak rozstrzygającego źródła nie oznacza, że to nieprawda.";
export function withAbsenceNote(text: string): string {
  return /nie oznacza|nie znaczy/i.test(text) ? text : `${text.trim()} ${ABSENCE_NOTE}`.trim();
}

/** Leading word when the model's own verdict is stale (code took a stance from a fact-check rating). */
export function plainFromVerdict(verdict: Verdict): PlainAnswer {
  return verdict === "confirmed" ? "yes" : verdict === "false" ? "no" : "neither";
}

/** Explanation from the fact-checker's rating, used when the model's explanation is stale. */
export function factcheckExplanation(decisive: VerifiedPassage[]): string | null {
  for (const p of decisive) {
    if (!isFactcheckCard(p.record)) continue;
    const rating = factcheckFields(p.record.text).rating;
    if (rating) return `${p.record.publisher} ocenia to twierdzenie jako „${rating}”.`;
  }
  return null;
}

// ── "Czy Demagog sprawdzał, czy X?" (organizer samples F, J; claim-extraction@4 rule 7) ──────────
// The verdict stays the verdict on X. The answer to the question asked comes first: "Tak." with the
// publisher and its rating when a fact-check by that publisher of this claim was found; otherwise
// that we did not find one, without "Tak."/"Nie." and never "there is no such article".
export function askedCheckerAnswer(asked: string, passages: VerifiedPassage[]): { lead: string; found: boolean } {
  // A rated card first; otherwise a decisive passage from that checker's own article (its corpus text).
  const byChecker = passages.filter((p) =>
    ["supports", "refutes", "misleading"].includes(p.stance) && isAskedChecker(asked, p.record.publisher)
  );
  const hit = byChecker.find((p) => isFactcheckCard(p.record)) ??
    byChecker.find((p) => p.record.tier === "factcheck");
  if (hit) {
    const raw = isFactcheckCard(hit.record) ? factcheckFields(hit.record.text).rating : null;
    // A numeric-only ClaimReview rating ("1") says nothing to a reader.
    const rating = raw && /\p{L}/u.test(raw) ? raw : null;
    return {
      found: true,
      lead: rating
        ? `Tak. ${hit.record.publisher} sprawdził to twierdzenie i ocenił je jako „${rating}”.`
        : `Tak. ${hit.record.publisher} sprawdził to twierdzenie.`,
    };
  }
  // A card by that checker that is only context (a related claim): saying "not found" next to it would
  // contradict the citation shown.
  const related = passages.find((p) => p.stance === "context" && isAskedChecker(asked, p.record.publisher) && isFactcheckCard(p.record));
  if (related) {
    return {
      found: false,
      lead: `${related.record.publisher} sprawdzał podobne twierdzenie, ale nie znaleźliśmy jego weryfikacji dokładnie tego.`,
    };
  }
  return {
    found: false,
    lead: `Nie znaleźliśmy weryfikacji ${asked.trim()} na ten temat w przeszukanych źródłach (to nie znaczy, że jej nie ma).`,
  };
}

/** The model is told not to start with Tak/Nie; any such word is removed so only code decides it. */
export function withLead(explanation: string, lead: string | null): string {
  const body = explanation.replace(LEAD_RE, "");
  const text = body ? body.charAt(0).toUpperCase() + body.slice(1) : body;
  return lead ? `${lead} ${text}` : text;
}
