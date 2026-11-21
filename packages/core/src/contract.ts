/**
 * The v1 API contract as zod schemas: validated in tests against both live-shaped and mock
 * responses (so mock and real can never drift), and served as JSON Schema at GET /api/v1/schema.
 * Must stay in sync with types.ts; the compile-time checks at the bottom fail if they diverge.
 * Wiki: .agents/project-info/architecture/api-reference.md
 */
import { z } from "zod";
import { CLAIM_TYPES, type CheckRequest, type CheckResponse, CONTRACT_VERSION, VERDICTS } from "./types.ts";

const nullableString = z.string().nullable();

export const WarningSchema = z.strictObject({
  type: z.enum([
    "archival_material",
    "sources_conflict",
    "known_narrative",
    "source_status",
    "implied_claim",
    "paraphrase",
    "injection_detected",
    "partial_analysis",
    "assumed_period",
    "illegible_media",
    "demo_data",
  ]),
  text: z.string(),
});

export const CitationSchema = z.strictObject({
  source_id: z.string(),
  title: z.string(),
  publisher: z.string(),
  published_at: nullableString,
  retrieved_at: z.string(),
  url: z.string(),
  excerpt: z.string(),
  stance: z.enum(["supports", "refutes", "misleading", "context"]),
  tier: z.enum(["official", "factcheck", "media", "other"]),
  route: z.string(),
});

export const RouteOutcomeSchema = z.strictObject({
  route: z.string(),
  label: z.string(),
  status: z.enum(["hits", "no_hits", "unavailable", "error", "timeout", "skipped"]),
  required: z.boolean(),
  detail: z.string().optional(),
});

export const ClaimResultSchema = z.strictObject({
  id: z.string(),
  text: z.string(),
  provenance: z.string(),
  class: z.enum(["fact", "opinion", "prediction"]),
  type: z.enum(CLAIM_TYPES).nullable(),
  time: z.string(),
  risk: z.enum(["high", "normal"]),
  verdict: z.enum(VERDICTS).nullable(),
  verdict_label: nullableString,
  system_state: z.enum(["source_unavailable", "technical_error", "not_processed"]).nullable(),
  system_message: nullableString,
  strength: z.strictObject({ level: z.enum(["high", "medium", "low"]), reasons: z.array(z.string()) }).nullable(),
  explanation: z.string(),
  missing: nullableString,
  citations: z.array(CitationSchema),
  warnings: z.array(WarningSchema),
  routes: z.array(RouteOutcomeSchema),
}).refine((c) => (c.verdict === null) !== (c.system_state === null), {
  message: "exactly one of verdict / system_state must be set",
});

export const CheckResponseSchema = z.strictObject({
  contract_version: z.literal(CONTRACT_VERSION),
  check_id: z.string(),
  status: z.enum([
    "ok",
    "partial",
    "needs_clarification",
    "out_of_scope",
    "not_a_claim",
    "input_rejected",
    "rate_limited",
    "technical_error",
  ]),
  answer_language: z.literal("pl"),
  system_message: z.strictObject({ title: z.string(), text: z.string() }).nullable(),
  summary: z.strictObject({ fact_claims: z.number().int(), opinions: z.number().int(), text: z.string() }),
  claims: z.array(ClaimResultSchema),
  warnings: z.array(WarningSchema),
  limitations: z.array(z.string()),
  escalation: z.strictObject({ state: z.enum(["none", "recommended"]), reason: nullableString }),
  input: z.strictObject({
    type: z.enum(["text", "url", "image"]),
    title: nullableString,
    url: nullableString,
    published_at: nullableString,
    description: nullableString,
  }),
  meta: z.strictObject({
    latency_ms: z.number(),
    stages_ms: z.record(z.string(), z.number()),
    models: z.array(z.string()),
    prompt_versions: z.array(z.string()),
    cost_usd: z.number(),
    cached: z.boolean(),
    mode: z.enum(["live", "mock"]),
  }),
});

export const CheckRequestSchema = z.strictObject({
  input: z.strictObject({ type: z.enum(["text", "url", "image"]), value: z.string() }),
  user_message: z.string().optional(),
  session_id: z.string().optional(),
  channel: z.enum(["web", "api", "messaging"]).optional(),
  mock: z.union([z.boolean(), z.string()]).optional(),
});

/** JSON Schema documents served by the API. */
export function contractJsonSchema() {
  return {
    contract_version: CONTRACT_VERSION,
    request: z.toJSONSchema(CheckRequestSchema),
    response: z.toJSONSchema(CheckResponseSchema, { unrepresentable: "any" }),
  };
}

// ── compile-time sync checks with types.ts ──────────────────────────────────
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _response: Same<z.infer<typeof CheckResponseSchema>, CheckResponse> = true;
const _request: Same<z.infer<typeof CheckRequestSchema>, CheckRequest> = true;
void _response;
void _request;
