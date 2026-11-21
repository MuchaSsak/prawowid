/**
 * The canonical result contract every channel renders (web now, a messaging bot later).
 * Wiki: .agents/project-info/product/response-contract.md
 */

export const VERDICTS = [
  "confirmed",
  "false",
  "misleading",
  "insufficient_evidence",
  "not_verifiable",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL_PL: Record<Verdict, string> = {
  confirmed: "potwierdzone",
  false: "fałszywe",
  misleading: "wprowadzające w błąd",
  insufficient_evidence: "brak wystarczających dowodów",
  not_verifiable: "nie podlega weryfikacji",
};

/** Request-level outcome. Only `ok` and `partial` carry claim verdicts. Everything else is a system state. */
export type RequestStatus =
  | "ok"
  | "partial"
  | "needs_clarification"
  | "out_of_scope"
  | "not_a_claim"
  | "input_rejected"
  | "rate_limited"
  | "technical_error";

/** Claim-level system states. Never a verdict (hard constraint 8). */
export type ClaimSystemState = "source_unavailable" | "technical_error" | "not_processed";

export type ClaimClass = "fact" | "opinion" | "prediction";
export const CLAIM_TYPES = [
  "numeric",
  "legal",
  "parliamentary",
  "official_statement",
  "event",
  "narrative",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export type SourceTier = "official" | "factcheck" | "media" | "other";
export type Stance = "supports" | "refutes" | "misleading" | "context" | "irrelevant";

export type WarningType =
  | "archival_material"
  | "sources_conflict"
  | "known_narrative"
  | "source_status"
  | "implied_claim"
  | "paraphrase"
  | "injection_detected"
  | "partial_analysis"
  | "assumed_period"
  | "illegible_media"
  /** Mock mode: the response is synthetic demo data, not a check. */
  | "demo_data";

export interface Warning {
  type: WarningType;
  text: string;
}

export interface Citation {
  source_id: string;
  title: string;
  publisher: string;
  published_at: string | null;
  retrieved_at: string;
  url: string;
  /** Verified verbatim quote from the stored record. */
  excerpt: string;
  stance: Exclude<Stance, "irrelevant">;
  tier: SourceTier;
  /** Which connector produced the record (e.g. google_factcheck). */
  route: string;
}

export type RouteStatus = "hits" | "no_hits" | "unavailable" | "error" | "timeout" | "skipped";
export interface RouteOutcome {
  route: string;
  label: string;
  status: RouteStatus;
  required: boolean;
  detail?: string;
}

export interface Strength {
  level: "high" | "medium" | "low";
  reasons: string[];
}

export interface ClaimResult {
  id: string;
  text: string;
  provenance: string;
  class: ClaimClass;
  type: ClaimType | null;
  time: string;
  risk: "high" | "normal";
  /** Exactly one of `verdict` / `system_state` is set. */
  verdict: Verdict | null;
  verdict_label: string | null;
  system_state: ClaimSystemState | null;
  system_message: string | null;
  strength: Strength | null;
  explanation: string;
  missing: string | null;
  citations: Citation[];
  warnings: Warning[];
  routes: RouteOutcome[];
}

export type InputType = "text" | "url" | "image";
export type Channel = "web" | "api" | "messaging";

/** Bumped only for breaking changes; v1 changes are additive (new optional fields, new enum values). */
export const CONTRACT_VERSION = "1.0";

export interface CheckRequest {
  input: { type: InputType; value: string };
  /** What the user typed themselves next to a URL or image (optional). */
  user_message?: string;
  session_id?: string;
  channel?: Channel;
  /** Mock mode: true = scenario picked from the input, or a scenario name (see mock/fixtures.ts). */
  mock?: boolean | string;
}

export interface SystemMessage {
  title: string;
  text: string;
}

export interface CheckResponse {
  contract_version: typeof CONTRACT_VERSION;
  check_id: string;
  status: RequestStatus;
  answer_language: "pl";
  system_message: SystemMessage | null;
  summary: { fact_claims: number; opinions: number; text: string };
  claims: ClaimResult[];
  /** Request-level notes (injection detected, partial extraction, source of a URL…). */
  warnings: Warning[];
  limitations: string[];
  escalation: { state: "none" | "recommended"; reason: string | null };
  input: {
    type: InputType;
    title: string | null;
    url: string | null;
    published_at: string | null;
    /** For images: the vision model's neutral description (context only, never a claim or evidence). */
    description: string | null;
  };
  meta: {
    latency_ms: number;
    stages_ms: Record<string, number>;
    models: string[];
    prompt_versions: string[];
    cost_usd: number;
    cached: boolean;
    /** "mock" = synthetic demo data; never shown as a real check. */
    mode: "live" | "mock";
  };
}
