/** Polish templates for system messages and fallback explanations (response-contract.md). */
import type { ClaimSystemState, RequestStatus, SystemMessage, Verdict } from "../types.ts";
import type { VerifiedPassage } from "./assess.ts";

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
      return "Nie znaleźliśmy wystarczających dowodów, by potwierdzić lub obalić to twierdzenie.";
    case "not_verifiable":
      return "To opinia, ocena lub prognoza, a nie twierdzenie o faktach.";
  }
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
