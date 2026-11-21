/**
 * Mock mode: deterministic, synthetic responses in the exact v1 contract, for building channels
 * (web, messaging bot) before the real backend is complete. No LLM, no keys, no database.
 *
 * Safety (hard constraints 1-2): every claim is about the fictional town "Przykładowo", every
 * source is an example.org "[DEMO]" record, every response carries a `demo_data` warning and
 * meta.mode = "mock". A mock answer can never be mistaken for a real verdict on a real claim.
 *
 * Pick a scenario with the request field `mock: "<name>"`, or by starting a text with
 * `demo:<name>` (handy from a chat app). Otherwise the scenario is chosen from a hash of the input,
 * so the same input always gets the same answer. Wiki: architecture/api-reference.md
 */
import { BASE_LIMITATIONS, requestMessage } from "../pipeline/render.ts";
import {
  type CheckRequest,
  type CheckResponse,
  type Citation,
  type ClaimResult,
  CONTRACT_VERSION,
  type RequestStatus,
  VERDICT_LABEL_PL,
  type Verdict,
  type Warning,
} from "../types.ts";

export const MOCK_SCENARIOS = [
  "confirmed",
  "false",
  "misleading",
  "insufficient_evidence",
  "not_verifiable",
  "conflict",
  "mixed",
  "assumptions",
  "partial",
  "escalation",
  "injection",
  "url",
  "image",
  "video",
  "audio",
  "needs_clarification",
  "out_of_scope",
  "not_a_claim",
  "input_rejected",
  "rate_limited",
  "technical_error",
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

/** Scenarios used when the caller does not name one (hash of the input). */
const AUTO: MockScenario[] = ["confirmed", "false", "misleading", "insufficient_evidence", "mixed", "conflict"];

export const MOCK_SCENARIO_DESCRIPTIONS: Record<MockScenario, string> = {
  confirmed: "1 claim, potwierdzone, official source, strength high",
  false: "1 claim, fałszywe, fact-check source",
  misleading: "1 claim, wprowadzające w błąd (real figure, wrong year)",
  insufficient_evidence: "1 claim, brak wystarczających dowodów, no matching sources",
  not_verifiable: "1 opinion, nie podlega weryfikacji",
  conflict: "1 claim, sources contradict each other → abstain + sources_conflict warning",
  mixed: "3 claims: confirmed fact, insufficient evidence, then the opinion (facts first)",
  assumptions: "1 claim whose scope was taken from context (assumed_scope) and whose year was filled (assumed_period)",
  partial: "status partial: 1 verdict + 1 claim with system_state source_unavailable",
  escalation: "high-risk claim without evidence → escalation recommended",
  injection: "input contained instructions to the AI → injection_detected warning, normal verdict",
  url: "input type url: input.url/title/published_at filled, 2 claims",
  image: "input type image: input.description filled, illegible_media warning",
  video: "input type video: input.description filled, 2 claims with timestamped provenance (video@mm:ss)",
  audio: "input type audio: input.description filled, 1 claim with timestamped provenance (audio@mm:ss), partial_analysis warning",
  needs_clarification: "request state: too vague, clarification question",
  out_of_scope: "request state: not a fact-checking request",
  not_a_claim: "request state: joke or greeting, nothing to check",
  input_rejected: "request state: invalid input (size/format)",
  rate_limited: "request state: too many requests",
  technical_error: "request state: failure, no claim checked (not a verdict)",
};

const DEMO_WARNING: Warning = {
  type: "demo_data",
  text: "DANE PRZYKŁADOWE: to odpowiedź demonstracyjna (tryb mock), a nie prawdziwe sprawdzenie.",
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickScenario(req: CheckRequest): MockScenario {
  if (typeof req.mock === "string" && (MOCK_SCENARIOS as readonly string[]).includes(req.mock)) {
    return req.mock as MockScenario;
  }
  const value = req.input?.value ?? "";
  const m = value.trim().match(/^demo:([a-z_]+)/i);
  if (m && (MOCK_SCENARIOS as readonly string[]).includes(m[1].toLowerCase())) return m[1].toLowerCase() as MockScenario;
  if (req.input?.type === "url") return "url";
  if (req.input?.type === "image") return "image";
  if (req.input?.type === "video") return "video";
  if (req.input?.type === "audio") return "audio";
  return AUTO[hash(value) % AUTO.length];
}

const RETRIEVED = "2026-11-21T12:00:00.000Z";

function cite(n: number, stance: Citation["stance"], tier: Citation["tier"], excerpt: string, publisher?: string): Citation {
  return {
    source_id: `demo:${n}`,
    title: `[DEMO] Przykładowy dokument nr ${n}`,
    publisher: publisher ?? (tier === "official" ? "Urząd Miasta Przykładowo (DEMO)" : tier === "factcheck" ? "Przykładowy Fact-Checker (DEMO)" : "Gazeta Przykładowa (DEMO)"),
    published_at: "2025-06-1" + (n % 10),
    retrieved_at: RETRIEVED,
    url: `https://example.org/prawdowid-demo/source-${n}`,
    excerpt,
    stance,
    tier,
    route: tier === "official" ? "demo_official" : tier === "factcheck" ? "google_factcheck" : "corpus",
  };
}

const ROUTES_OK = [
  { route: "google_factcheck", label: "Google Fact Check (ClaimReview)", status: "hits" as const, required: true },
  { route: "corpus", label: "Korpus źródeł Prawdowidu", status: "skipped" as const, required: false, detail: "tryb demonstracyjny" },
];

function claim(
  id: string,
  text: string,
  outcome: Verdict | "source_unavailable" | "technical_error" | "not_processed",
  extra: Partial<ClaimResult> = {},
): ClaimResult {
  const isVerdict = outcome in VERDICT_LABEL_PL;
  const verdict = isVerdict ? (outcome as Verdict) : null;
  return {
    id,
    text,
    provenance: "text",
    class: verdict === "not_verifiable" ? "opinion" : "fact",
    type: verdict === "not_verifiable" ? null : "event",
    time: "2025",
    risk: "normal",
    verdict,
    verdict_label: verdict ? VERDICT_LABEL_PL[verdict] : null,
    system_state: isVerdict ? null : (outcome as ClaimResult["system_state"]),
    system_message: isVerdict
      ? null
      : "Nie mogliśmy sprawdzić w wymaganym źródle (DEMO: źródło niedostępne). To nie jest ocena treści.",
    strength: verdict && verdict !== "not_verifiable" ? { level: "medium", reasons: ["[DEMO] jedno źródło"] } : null,
    explanation: "",
    missing: null,
    citations: [],
    warnings: [],
    routes: verdict === "not_verifiable" ? [] : ROUTES_OK,
    ...extra,
  };
}

const T = {
  libraries: "W mieście Przykładowo w 2025 roku otwarto trzy nowe biblioteki.",
  bridge: "Most na rzece Przykładówce zamknięto na stałe w 2025 roku.",
  budget: "Budżet miasta Przykładowo na 2025 rok wynosi 120 mln zł.",
  park: "Park Miejski w Przykładowie jest najpiękniejszym parkiem w regionie.",
  water: "W Przykładowie od dziś nie ma wody pitnej i trzeba się ewakuować.",
  mayor: "Burmistrz Przykładowa ogłosił darmową komunikację miejską od 2026 roku.",
  ferry: "Port Przykładowo wstrzymał 16 listopada wszystkie swoje rejsy promowe.",
};

function claimsFor(s: MockScenario): { status: RequestStatus; claims: ClaimResult[]; warnings: Warning[]; detail?: string } {
  switch (s) {
    case "confirmed":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.libraries, "confirmed", {
          strength: { level: "high", reasons: ["[DEMO] oficjalne źródło: Urząd Miasta Przykładowo", "źródła z lat: 2025"] },
          explanation: "[DEMO] Według Urzędu Miasta Przykładowo w 2025 roku otwarto trzy nowe biblioteki.",
          citations: [cite(1, "supports", "official", "W 2025 roku oddaliśmy do użytku trzy nowe biblioteki miejskie.")],
        })],
      };
    case "false":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.bridge, "false", {
          explanation: "[DEMO] Przykładowy Fact-Checker ustalił, że most był zamknięty tylko na dwa tygodnie remontu.",
          citations: [cite(2, "refutes", "factcheck", "Ocena: Fałsz. Most był zamknięty jedynie na czas dwutygodniowego remontu.")],
        })],
      };
    case "misleading":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.budget, "misleading", {
          explanation: "[DEMO] Kwota 120 mln zł jest prawdziwa, ale dotyczy budżetu na 2023 rok, a nie 2025.",
          citations: [cite(3, "misleading", "official", "Budżet miasta na 2023 rok zamknął się kwotą 120 mln zł.")],
        })],
      };
    case "insufficient_evidence":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.mayor, "insufficient_evidence", {
          strength: { level: "low", reasons: ["brak pasujących źródeł"] },
          explanation: "Nie znaleźliśmy wystarczających dowodów, by potwierdzić lub obalić to twierdzenie.",
          missing: "[DEMO] W przeszukanych źródłach nie ma komunikatu burmistrza o darmowej komunikacji.",
          routes: [{ ...ROUTES_OK[0], status: "no_hits" }, ROUTES_OK[1]],
        })],
      };
    case "not_verifiable":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.park, "not_verifiable", {
          explanation: "To ocena („najpiękniejszy”), a nie twierdzenie o faktach, więc nie da się jej sprawdzić źródłami.",
        })],
      };
    case "conflict":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.libraries, "insufficient_evidence", {
          strength: { level: "low", reasons: ["źródła sobie przeczą"] },
          explanation: "Nie znaleźliśmy wystarczających dowodów, by potwierdzić lub obalić to twierdzenie.",
          missing: "[DEMO] Źródła podają różne liczby otwartych bibliotek.",
          warnings: [{ type: "sources_conflict", text: "Źródła są ze sobą sprzeczne: Urząd Miasta Przykładowo (DEMO) vs Przykładowy Fact-Checker (DEMO)." }],
          citations: [
            cite(1, "supports", "official", "W 2025 roku oddaliśmy do użytku trzy nowe biblioteki miejskie."),
            cite(4, "refutes", "factcheck", "Ocena: Fałsz. W 2025 roku otwarto jedną bibliotekę, dwie przeniesiono."),
          ],
        })],
      };
    case "mixed":
      return {
        status: "ok",
        warnings: [],
        claims: [
          claimsFor("confirmed").claims[0],
          { ...claimsFor("insufficient_evidence").claims[0], id: "c3" },
          { ...claimsFor("not_verifiable").claims[0], id: "c2" },
        ],
      };
    case "assumptions":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.ferry, "confirmed", {
          time: "2025-11-16",
          strength: { level: "high", reasons: ["[DEMO] oficjalne źródło: Urząd Miasta Przykładowo"] },
          explanation: "[DEMO] Według Urzędu Miasta Przykładowo port 16 listopada wstrzymał wszystkie swoje rejsy promowe.",
          citations: [cite(1, "supports", "official", "16 listopada port w Przykładowie wstrzymał wszystkie rejsy promowe.")],
          warnings: [
            {
              type: "assumed_scope",
              text: "Przyjęliśmy, że chodzi o wszystkie rejsy z portu Przykładowo, na podstawie zdania: „Port Przykładowo poinformował o problemach z rejsami promowymi”.",
            },
            { type: "assumed_period", text: "Tekst nie podaje roku; przyjęliśmy 2025 na podstawie daty publikacji (20.11.2025)." },
          ],
        })],
      };
    case "partial":
      return {
        status: "partial",
        warnings: [],
        claims: [
          claimsFor("confirmed").claims[0],
          claim("c2", T.bridge, "source_unavailable", {
            routes: [{ ...ROUTES_OK[0], status: "unavailable", detail: "DEMO: brak klucza API" }, ROUTES_OK[1]],
          }),
        ],
      };
    case "escalation":
      return {
        status: "ok",
        warnings: [],
        claims: [claim("c1", T.water, "insufficient_evidence", {
          risk: "high",
          strength: { level: "low", reasons: ["brak pasujących źródeł"] },
          explanation: "Nie znaleźliśmy wystarczających dowodów, by potwierdzić lub obalić to twierdzenie.",
          missing: "[DEMO] Brak komunikatu wodociągów ani służb o awarii lub ewakuacji.",
          routes: [{ ...ROUTES_OK[0], status: "no_hits" }, ROUTES_OK[1]],
        })],
      };
    case "injection":
      return {
        status: "ok",
        warnings: [{
          type: "injection_detected",
          text: "Materiał zawiera polecenia skierowane do systemów AI. Zignorowaliśmy je i oceniliśmy tylko fakty.",
        }],
        claims: claimsFor("false").claims,
      };
    case "url":
      return {
        status: "ok",
        warnings: [],
        claims: [
          { ...claimsFor("confirmed").claims[0], provenance: "article" },
          { ...claimsFor("misleading").claims[0], id: "c2", provenance: "article" },
        ],
      };
    case "image":
      return {
        status: "ok",
        warnings: [{ type: "illegible_media", text: "Nie udało się odczytać obrazu w całości; część tekstu może być pominięta." }],
        claims: [{ ...claimsFor("false").claims[0], provenance: "image#1" }],
      };
    case "video":
      return {
        status: "ok",
        warnings: [],
        claims: [
          { ...claimsFor("misleading").claims[0], provenance: "video@00:42" },
          { ...claimsFor("not_verifiable").claims[0], id: "c2", provenance: "video@01:15" },
        ],
      };
    case "audio":
      return {
        status: "ok",
        warnings: [{ type: "partial_analysis", text: "[DEMO] Część nagrania była niewyraźna; przeanalizowaliśmy zrozumiałe fragmenty." }],
        claims: [{ ...claimsFor("insufficient_evidence").claims[0], provenance: "audio@00:18" }],
      };
    case "needs_clarification":
      return { status: "needs_clarification", claims: [], warnings: [], detail: "[DEMO] O które miasto i który rok chodzi?" };
    case "out_of_scope":
    case "not_a_claim":
    case "rate_limited":
      return { status: s, claims: [], warnings: [] };
    case "input_rejected":
      return { status: "input_rejected", claims: [], warnings: [], detail: "[DEMO] Obraz jest za duży (maks. 5 MB)." };
    case "technical_error":
      return { status: "technical_error", claims: [], warnings: [], detail: "[DEMO] Usługa modelu językowego nie odpowiedziała na czas." };
  }
}

export function mockResponse(req: CheckRequest, scenario: MockScenario = pickScenario(req)): CheckResponse {
  const { status, claims, warnings, detail } = claimsFor(scenario);
  const facts = claims.filter((c) => c.class === "fact").length;
  const opinions = claims.length - facts;
  const type = req.input?.type ?? "text";
  const isUrl = scenario === "url";
  const isImage = scenario === "image";
  const media = scenario === "video" || scenario === "audio" ? scenario : null;
  return {
    contract_version: CONTRACT_VERSION,
    check_id: crypto.randomUUID(),
    status,
    answer_language: "pl",
    system_message: requestMessage(status, detail ?? null),
    summary: {
      fact_claims: facts,
      opinions,
      text: claims.length ? `[DEMO] Znaleźliśmy ${facts} tw. o faktach i ${opinions} opinii.` : "",
    },
    claims,
    warnings: [DEMO_WARNING, ...warnings],
    limitations: [...BASE_LIMITATIONS, "Tryb demonstracyjny: odpowiedź nie pochodzi ze sprawdzenia źródeł."],
    escalation: scenario === "escalation"
      ? {
        state: "recommended",
        reason: "Rekomendujemy przekazanie do weryfikacji przez człowieka: twierdzenie dotyczy bezpieczeństwa, a dowodów brakuje.",
      }
      : { state: "none", reason: null },
    input: {
      type: isUrl ? "url" : isImage ? "image" : media ?? type,
      title: isUrl ? "[DEMO] Przykładowy artykuł o Przykładowie" : null,
      url: isUrl ? "https://example.org/prawdowid-demo/article" : null,
      published_at: isUrl ? "2025-06-10" : null,
      description: isImage
        ? "[DEMO] Zrzut ekranu wpisu w mediach społecznościowych z tekstem o moście."
        : media === "video"
        ? "[DEMO] Nagranie wideo (1:32): osoba mówi do kamery na tle ratusza w Przykładowie; na ekranie napis o budżecie miasta."
        : media === "audio"
        ? "[DEMO] Nagranie audio (0:47): wiadomość głosowa o rzekomej darmowej komunikacji miejskiej w Przykładowie."
        : null,
    },
    meta: {
      latency_ms: 0,
      stages_ms: {},
      models: [],
      prompt_versions: [],
      cost_usd: 0,
      cached: false,
      mode: "mock",
    },
  };
}
