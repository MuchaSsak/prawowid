/**
 * Regression tests for findings of the full code review (Claude Fable 5.2, GPT Astra, 2026-11-22).
 * Scripted model and sources, no network. Synthetic data only (rule 16).
 */
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { ConnectorError, runCheck, safeErrorMessage } from "../src/mod.ts";
import { deps, extraction, json, stubFetch, T } from "./harness.ts";

const CLAIM = "Most w Przykładowie zamknięto na stałe w 2025 roku.";
const text = (value: string) => ({ input: { type: "text" as const, value } });

Deno.test("safeErrorMessage: a runtime error with the request URL never carries its query (API keys)", () => {
  const err = new TypeError(
    "error sending request for url (https://factchecktools.googleapis.com/v1alpha1/claims:search?query=x&key=SECRET123): connection reset",
  );
  const safe = safeErrorMessage(err);
  assert(!safe.includes("SECRET123"), safe);
  assert(safe.includes("factchecktools.googleapis.com"), "the host stays, so the failure is still diagnosable");
});

Deno.test({ ...T, name: "Google Fact Check: Polish queries fail, English finds nothing → system state, never 'brak dowodów'", async fn() {
  const s = stubFetch(
    { extraction: () => extraction([{ text: CLAIM }]) },
    { googleFactCheck: (_q, lang) => (lang === "pl" ? json({ error: "unavailable" }, 503) : {}) },
  );
  try {
    const r = await runCheck(text(CLAIM), deps());
    const c = r.claims[0];
    assertEquals(c.verdict, null);
    assert(c.system_state === "technical_error" || c.system_state === "source_unavailable", String(c.system_state));
    const gfc = c.routes.find((x) => x.route === "google_factcheck");
    assert(gfc && gfc.status !== "no_hits", JSON.stringify(gfc));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "a transport error from a route never leaks the request's query string into the answer", async fn() {
  const s = stubFetch({ extraction: () => extraction([{ text: CLAIM }]) }, {
    googleFactCheck: () => {
      throw new TypeError("error sending request for url (https://factchecktools.googleapis.com/v1alpha1/claims:search?key=test-key): reset");
    },
  });
  try {
    const r = await runCheck(text(CLAIM), deps());
    assert(!JSON.stringify(r).includes("key=test-key"), "the key must not reach the response");
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "checkable input whose every claim fails validation → technical_error, not an empty 'ok'", async fn() {
  const s = stubFetch({ extraction: () => extraction([{ text: CLAIM, span: "zdanie, którego nie ma w tekście" }]) });
  try {
    const r = await runCheck(text(CLAIM), deps());
    assertEquals(r.status, "technical_error");
    assertEquals(r.claims, []);
    assert(r.system_message?.text.includes("Nie udało się"), JSON.stringify(r.system_message));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "a non-string user_message is ignored, not an HTTP 500", async fn() {
  const s = stubFetch({ extraction: () => extraction([]) });
  try {
    const r = await runCheck({ ...text(CLAIM), user_message: 5 as unknown as string }, deps());
    assert(r.status !== undefined);
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "a partial answer (a source failed) is not cached: the retry asks the source again", async fn() {
  let nbpCalls = 0;
  const s = stubFetch(
    {
      extraction: () =>
        extraction([{ text: "Kurs euro 20 listopada 2026 wynosił 4,25 zł.", indicator: "exchange_rate", currency: "EUR", claimed_value: 4.25 }]),
    },
    {
      nbp: () => {
        nbpCalls++;
        return json({ error: "x" }, 500);
      },
    },
  );
  try {
    const d = deps();
    const first = await runCheck(text("Kurs euro 20 listopada 2026 wynosił 4,25 zł."), d);
    assert(first.status !== "ok", first.status);
    const callsAfterFirst = nbpCalls;
    const second = await runCheck(text("Kurs euro 20 listopada 2026 wynosił 4,25 zł."), d);
    assertEquals(second.meta.cached, false);
    assert(nbpCalls > callsAfterFirst, "the retry must query NBP again");
  } finally {
    s.restore();
  }
} });

// Keeps the ConnectorError import meaningful for type checks in this file.
void ConnectorError;

Deno.test("ratingStance: every Demagog label in the corpus gets a stance (or none when it can't decide)", async () => {
  const { ratingStance } = await import("../src/pipeline/factcheck.ts");
  const cases: [string, string | null][] = [
    ["Fałsz", "refutes"], ["Prawda", "supports"], ["Brakujący kontekst", "misleading"], ["Manipulacja", "misleading"],
    ["Częściowy fałsz", "misleading"], ["Przerobione zdjęcie", "refutes"], ["Przerobiony film", "refutes"],
    ["Неправда", "refutes"], ["Фальш", "refutes"], ["Правда", "supports"], ["Nieweryfikowalne", null], ["Satyra", null],
  ];
  for (const [rating, want] of cases) assertEquals(ratingStance(rating), want, rating);
});
