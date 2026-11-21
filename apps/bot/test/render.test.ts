import { describe, expect, test } from "bun:test";
import type { CheckResponse } from "@prawdowid/core/types";
// The same fixtures the API returns in mock mode.
import { MOCK_SCENARIOS, mockResponse } from "../../../packages/core/src/mock/fixtures.js";
import { MAX_REPLY_CHARS, PLATFORMS, type Surface } from "../src/config.js";
import { ESCALATION_TEXT, renderDeleted, renderHelp, renderResponse } from "../src/render.js";
import { safeUrl, sanitizeText } from "../src/sanitize.js";
import { validateCheckResponse } from "../src/validate.js";

const SURFACES: Surface[] = [...PLATFORMS, "console"];
const VERDICT_LABELS = ["POTWIERDZONE", "FAŁSZYWE", "WPROWADZAJĄCE W BŁĄD", "BRAK WYSTARCZAJĄCYCH DOWODÓW", "NIE PODLEGA WERYFIKACJI"];
const REQUEST_STATES = ["needs_clarification", "out_of_scope", "not_a_claim", "input_rejected", "rate_limited", "technical_error"];
const mock = (s: string) => mockResponse({ input: { type: "text", value: "x" } }, s as never);

describe("render: every mock scenario on every surface", () => {
  for (const scenario of MOCK_SCENARIOS) {
    for (const surface of SURFACES) {
      test(`${scenario} / ${surface}`, () => {
        const res = mock(scenario);
        expect(validateCheckResponse(res).ok).toBe(true);
        const out = renderResponse(res, { surface, webUrl: "https://prawdowid.example" });
        expect(out.length).toBeLessThanOrEqual(MAX_REPLY_CHARS[surface]);
        // Mock data is always labelled first (hard constraints 1, 2).
        expect(out.startsWith("🧪")).toBe(true);
        expect(out).toContain("DANE DEMO");
        if (REQUEST_STATES.includes(scenario)) {
          // A system state is never shown as a verdict (hard constraint 8).
          for (const l of VERDICT_LABELS) expect(out).not.toContain(l);
        }
        // Native formatting.
        if (surface === "whatsapp") expect(out).not.toContain("**");
        if (surface === "messenger" || surface === "console") expect(out).not.toMatch(/\*[^*\s]/);
        if (surface === "discord") {
          expect(out).toContain("Prywatność: /pomoc");
          // Every link is wrapped in <> so Discord never previews it.
          for (const m of out.matchAll(/https:\/\/\S+/g)) expect(out[m.index - 1]).toBe("<");
        } else {
          expect(out).toContain("Prywatność: napisz pomoc");
        }
      });
    }
  }

  test("escalation uses the exact wording, never 'przekazano'", () => {
    const out = renderResponse(mock("escalation"), { surface: "discord", webUrl: null });
    expect(out).toContain(ESCALATION_TEXT);
    expect(out.toLowerCase()).not.toContain("przekazano");
  });

  test("a screenshot gets the deepfake limitation", () => {
    const res = mockResponse({ input: { type: "image", value: "data:image/png;base64,AA==" } });
    expect(renderResponse(res, { surface: "whatsapp", webUrl: null })).toContain("nie wykrywamy deepfake'ów");
  });

  test("a verdict claim shows its label and up to 3 source links", () => {
    const res = mock("false");
    const out = renderResponse(res, { surface: "console", webUrl: null });
    expect(out).toContain("FAŁSZYWE");
    expect(out).toContain("Sprawdź sam:");
    expect(out).toContain(res.claims[0].citations[0].url);
  });

  test("a tight limit hides whole claims and counts them", () => {
    const out = renderResponse(mock("mixed"), { surface: "discord", webUrl: "https://w.example", maxChars: 700 });
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out).toMatch(/…i jeszcze \d twierdzeni/);
  });

  test("the demo banner follows the response, even if only warnings[0] says so", () => {
    const res = mock("confirmed");
    res.meta.mode = "live";
    expect(renderResponse(res, { surface: "console", webUrl: null })).toContain("DANE DEMO");
    res.warnings = [];
    expect(renderResponse(res, { surface: "console", webUrl: null })).not.toContain("DANE DEMO");
  });
});

describe("render: versioning (unknown values) and hostile content", () => {
  test("an unknown request status becomes a generic system notice", () => {
    const res = { ...mock("confirmed"), status: "brand_new_state" } as unknown as CheckResponse;
    const out = renderResponse(res, { surface: "console", webUrl: null });
    expect(out).toContain("To nie jest ocena treści");
    for (const l of VERDICT_LABELS) expect(out).not.toContain(l);
  });

  test("an unknown claim system state or verdict is a notice, not a verdict", () => {
    const res = mock("confirmed");
    res.claims[0] = { ...res.claims[0], verdict: "maybe" as never, verdict_label: "może", system_message: null };
    const out = renderResponse(res, { surface: "console", webUrl: null });
    expect(out).toContain("Nie sprawdzono");
    expect(out).not.toContain("może");
  });

  test("A10: a source title, publisher and explanation can't ping, link or format", () => {
    const res = mock("false");
    const c = res.claims[0];
    c.explanation = "@everyone **pilne** [kliknij](https://evil.example/x) <@123456> <#42> evil.example.com";
    c.citations[0].publisher = "@here Wydawca <@&99>";
    c.citations.push({ ...c.citations[0], url: "javascript:alert(1)" }, { ...c.citations[0], url: "http://plain.example/" });
    const out = renderResponse(res, { surface: "discord", webUrl: null });
    expect(out).not.toMatch(/@everyone|@here|<@|<#|\[kliknij\]|evil\.example/);
    expect(out).toContain("evil[.]example[.]com");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("http://plain");
  });

  test("long citation URLs drop the links before the footer is ever cut", () => {
    const res = mock("escalation");
    const long = (n: number) => `https://example.org/${"a".repeat(1500)}/${n}`;
    res.claims[0].citations = [1, 2, 3].map((n) => ({ ...mock("false").claims[0].citations[0], url: long(n) }));
    const out = renderResponse(res, { surface: "discord", webUrl: "https://w.example" });
    expect(out.length).toBeLessThanOrEqual(1900);
    expect(out).toContain(ESCALATION_TEXT);
    expect(out).toContain("Prywatność: /pomoc");
    expect(out.endsWith("…")).toBe(false);
  });

  test("an over-long first citation URL doesn't hide the links after it", () => {
    const res = mock("false");
    const base = res.claims[0].citations[0];
    res.claims[0].citations = [{ ...base, url: `https://example.org/${"a".repeat(1500)}` }, { ...base, url: "https://example.org/ok" }];
    const out = renderResponse(res, { surface: "console", webUrl: null });
    expect(out).toContain("https://example.org/ok");
    expect(out).not.toContain("aaaaaaaaaa");
  });

  test("an all-failed technical_error shows each claim's system notice, never a verdict", () => {
    const res = mock("partial");
    res.status = "technical_error";
    res.system_message = { title: "Nie udało się zakończyć sprawdzania", text: "Szczegóły przy twierdzeniach. To nie jest ocena treści." };
    res.claims = res.claims.filter((c) => c.verdict === null);
    res.claims.push({ ...mock("false").claims[0] }); // a stray verdict must not show under a request state
    const out = renderResponse(res, { surface: "console", webUrl: null });
    expect(out).toContain("Nie udało się zakończyć sprawdzania");
    expect(out).toContain("Nie sprawdzono");
    expect(out).toContain("źródło niedostępne");
    for (const l of VERDICT_LABELS) expect(out).not.toContain(l);
  });

  test("delete and help texts", () => {
    expect(renderDeleted({ ok: true, checks: 2 }, { surface: "console", webUrl: null })).toContain("(liczba przybliżona)");
    expect(renderDeleted({ ok: true, checks: 0 }, { surface: "console", webUrl: null })).toContain("nie znaleźliśmy".replace("n", "N"));
    for (const surface of SURFACES) {
      const help = renderHelp({ surface, webUrl: "https://w.example", mode: "mock", controller: "Zespół X, x@example.org" });
      expect(help.length).toBeLessThanOrEqual(MAX_REPLY_CHARS[surface]);
      expect(help).toContain("UODO");
      expect(help).toContain("30 dni");
    }
  });
});

describe("sanitize", () => {
  test("NFKC, invisible and control characters", () => {
    expect(sanitizeText("ﬁ​ne\u0007 te‮xt")).toBe("fine text");
  });
  test("keeps identifiers and ordinary punctuation", () => {
    expect(sanitizeText("brak klucza OPENROUTER_API_KEY, m.in. 1.5 mln (art. 5)")).toBe(
      "brak klucza OPENROUTER_API_KEY, m.in. 1.5 mln (art. 5)",
    );
  });
  test("defangs urls and bare domains", () => {
    expect(sanitizeText("zobacz https://www.gov.pl/web/x i stooq.pl")).toBe("zobacz www[.]gov[.]pl i stooq[.]pl");
  });
  test("formatting can't re-form a domain; single-letter domains are defanged; m.in. is kept", () => {
    expect(sanitizeText("example.*org* i _x_.com")).toBe("example[.]org i x[.]com");
    expect(sanitizeText("a.pl, t.co")).toBe("a[.]pl, t[.]co");
    expect(sanitizeText("m.in. urzędy")).toBe("m.in. urzędy");
    expect(sanitizeText("m.in/potwierdzenie")).toBe("m[.]in/potwierdzenie");
  });
  test("non-strings and length", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText("a".repeat(50), 10)).toHaveLength(10);
  });
  test("safeUrl: https only, no credentials, < > @ encoded", () => {
    expect(safeUrl("http://a.example/")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://user:pw@a.example/")).toBeNull();
    expect(safeUrl("https://a.example/<x>@everyone")).toBe("https://a.example/%3Cx%3E%40everyone");
    // The cap applies to the encoded URL: 300 Polish letters become ~1800 characters.
    expect(safeUrl(`https://a.example/${"ż".repeat(300)}`, 500)).toBeNull();
  });
});

describe("validate", () => {
  test("structural errors are reported", () => {
    expect(validateCheckResponse(null).ok).toBe(false);
    expect(validateCheckResponse({ ...mock("confirmed"), claims: "x" }).ok).toBe(false);
    const bad = mock("confirmed") as unknown as { claims: { citations: { url: unknown }[] }[] };
    bad.claims[0].citations[0].url = 5;
    const v = validateCheckResponse(bad);
    expect(v.ok === false && v.errors[0]).toBe("claims[0].citations[0].url");
  });
  test("v2 contracts are refused", () => {
    expect(validateCheckResponse({ ...mock("confirmed"), contract_version: "2.0" }).ok).toBe(false);
  });
});
