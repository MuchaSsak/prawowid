/**
 * Demo scenarios offered by Discord's `/demo` dropdown (and listed in /pomoc). The names are the
 * API's mock scenarios (GET /api/v1/mock/scenarios); `/demo x` is sent exactly like the text
 * `demo:x`, so the same `demo:` gate applies: it only runs while the API answers this bot in mock.
 * Discord allows at most 25 choices.
 */
export const DEMO_SCENARIOS: { value: string; label: string }[] = [
  { value: "confirmed", label: "Potwierdzone" },
  { value: "false", label: "Fałszywe" },
  { value: "misleading", label: "Wprowadzające w błąd" },
  { value: "insufficient_evidence", label: "Brak wystarczających dowodów" },
  { value: "not_verifiable", label: "Nie podlega weryfikacji (opinia)" },
  { value: "conflict", label: "Źródła sobie przeczą" },
  { value: "mixed", label: "Kilka twierdzeń naraz" },
  { value: "partial", label: "Częściowe sprawdzenie (źródło niedostępne)" },
  { value: "escalation", label: "Rekomendacja weryfikacji przez człowieka" },
  { value: "injection", label: "Próba manipulacji AI w treści" },
  { value: "url", label: "Link do artykułu" },
  { value: "image", label: "Zrzut ekranu" },
  { value: "needs_clarification", label: "Komunikat: doprecyzuj pytanie" },
  { value: "out_of_scope", label: "Komunikat: poza zakresem" },
  { value: "not_a_claim", label: "Komunikat: to nie jest twierdzenie" },
  { value: "input_rejected", label: "Komunikat: odrzucone dane" },
  { value: "rate_limited", label: "Komunikat: za dużo zapytań" },
  { value: "technical_error", label: "Komunikat: awaria techniczna" },
];

const VALUES = new Set(DEMO_SCENARIOS.map((s) => s.value));

/** `/demo` option value → the `demo:<scenario>` text, or null for anything not on the list. */
export function demoText(value: unknown): string | null {
  return typeof value === "string" && VALUES.has(value) ? `demo:${value}` : null;
}
