/**
 * Storage interfaces. Today: in-memory mock (memory.ts). Later: Supabase, with these rows mapped to
 * the private schema of decisions/001 (private.check_logs, private.check_events, private.sessions)
 * and corpus.documents / corpus.chunks. Only the server talks to storage; clients never do.
 */
import type { SourceRecord } from "../connectors/types.ts";
import type { CheckResponse, ClaimType, InputType, RequestStatus } from "../types.ts";

export interface CheckLogRow {
  check_id: string;
  /** sha256 of the client session id; the raw id is never stored. */
  session_hash: string | null;
  channel: string;
  input_type: InputType;
  /** PII-masked input, truncated. Never the raw input or provider payloads. */
  masked_input: string;
  status: RequestStatus;
  claims: {
    id: string;
    verdict: string | null;
    system_state: string | null;
    source_ids: string[];
    /** Masked claim text (extracted from the masked input), for admin analytics. Never in the host log. */
    text?: string;
    type?: ClaimType | null;
    class?: "fact" | "opinion" | "prediction";
    /** A known-incident (EUvsDisinfo) context match was shown next to the claim. */
    context_match?: boolean;
  }[];
  latency_ms: number;
  models: string[];
  prompt_versions: string[];
  cost_usd: number;
  created_at: string;
}

export type CheckEventType =
  | "injection_detected"
  | "quote_rejected"
  | "span_rejected"
  | "verdict_disagreement"
  | "rating_override"
  | "number_check"
  | "extraction_escalated"
  /** Known-incident context shown next to a claim (EUvsDisinfo); never evidence. */
  | "context_match"
  | "route_error"
  | "llm_error"
  | "intake_error"
  | "pii_redacted";

export interface CheckEventRow {
  check_id: string;
  type: CheckEventType;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface CheckStore {
  saveCheck(row: CheckLogRow): Promise<void>;
  logEvent(row: CheckEventRow): Promise<void>;
  getCached(key: string): Promise<CheckResponse | null>;
  setCached(key: string, value: CheckResponse, sessionHash: string | null): Promise<void>;
  /** DELETE /api/session/{id}: removes the session's checks, events and cache entries. */
  deleteSession(sessionHash: string): Promise<{ checks: number }>;
  listRecent(limit: number): Promise<CheckLogRow[]>;
  /** Admin analytics: checks and events created after `since`. */
  listSince(since: Date): Promise<{ checks: CheckLogRow[]; events: CheckEventRow[] }>;
  prune(now: Date): Promise<void>;
}

export interface CorpusStore {
  size(): number;
  search(
    queries: string[],
    limit: number,
    options?: { sources?: string[]; tiers?: string[]; dateFrom?: string; dateTo?: string },
    signal?: AbortSignal,
  ): Promise<SourceRecord[]>;
  upsert(records: SourceRecord[]): Promise<void>;
}
