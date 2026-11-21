/**
 * One config module (decision 003): `.env` holds only secrets; models, routing and limits are
 * defaults here. A model can be swapped with an optional MODEL_<STEP> env var, no rebuild
 * (hard constraint 19).
 */
import { TRUSTED_SOURCES, type TrustedSource } from "./sources/catalog.ts";

/** Minimal env reader so the core stays runtime-agnostic (Deno, Bun, Node, edge). */
export interface Env {
  get(key: string): string | undefined;
}

export type ModelStep = "claim_extraction" | "evidence_assessment" | "image_extraction";

export const DEFAULT_MODELS: Record<ModelStep, string> = {
  claim_extraction: "mistralai/mistral-small-2603",
  // Large, not Small: in smoke tests (2026-11-21) Small labelled a bare act title as "supports" and
  // produced confident wrong verdicts; Large did not. See architecture/model-selection.md.
  evidence_assessment: "mistralai/mistral-large-2512",
  image_extraction: "mistralai/mistral-small-2603",
};

export interface ProviderRouting {
  data_collection: "deny" | "allow";
  zdr?: boolean;
  only?: string[];
  allow_fallbacks?: boolean;
}

/**
 * Provider routing per model family (set per step, never account-wide; see model-selection.md).
 * Mistral models are pinned to Mistral's own EU endpoint. Everything gets data_collection=deny.
 */
export function routingFor(model: string): ProviderRouting {
  if (model.startsWith("mistralai/")) {
    return { data_collection: "deny", only: ["mistral/eu"], allow_fallbacks: false };
  }
  return { data_collection: "deny", zdr: true };
}

export const LIMITS = {
  /** Characters of material sent to claim extraction (pasted text or a fetched article). */
  maxMaterialChars: 12_000,
  maxImageBytes: 5 * 1024 * 1024,
  /** Video and audio uploads (data URLs). Kept under the API's 8 MB JSON body after base64. */
  maxMediaBytes: 5 * 1024 * 1024,
  /** Fact claims kept after extraction (prompt v1 says 8; pipeline draft says 12: open question). */
  maxFactClaims: 8,
  passagesPerClaim: 5,
  /** Whole request budget, shared by all stages. */
  requestDeadlineMs: 30_000,
  extractionTimeoutMs: 15_000,
  assessmentTimeoutMs: 14_000,
  imageTimeoutMs: 15_000,
  connectorTimeoutMs: 6_000,
  urlFetchTimeoutMs: 8_000,
  urlMaxBytes: 3 * 1024 * 1024,
  urlMaxRedirects: 3,
  /** Same normalized input within this window returns the same canonical result (scenario G). */
  cacheTtlMs: 5 * 60_000,
  /** decisions/001: 30-day retention for logs. */
  retentionDays: 30,
};

export const USER_AGENT = "PrawdowidBot/0.1 (+fact-checking for citizens; hackathon prototype)";

export interface Config {
  models: Record<ModelStep, string>;
  /** Allowlist of publishers whose records may become evidence (sources/catalog.ts). */
  trustedSources: TrustedSource[];
  secrets: {
    openrouterApiKey?: string;
    googleFactCheckApiKey?: string;
  };
}

export function loadConfig(env: Env): Config {
  const model = (step: ModelStep) => env.get(`MODEL_${step.toUpperCase()}`)?.trim() || DEFAULT_MODELS[step];
  const secret = (key: string) => env.get(key)?.trim() || undefined;
  return {
    models: {
      claim_extraction: model("claim_extraction"),
      evidence_assessment: model("evidence_assessment"),
      image_extraction: model("image_extraction"),
    },
    trustedSources: TRUSTED_SOURCES,
    secrets: {
      openrouterApiKey: secret("OPENROUTER_API_KEY"),
      googleFactCheckApiKey: secret("GOOGLE_FACT_CHECK_API_KEY"),
    },
  };
}
