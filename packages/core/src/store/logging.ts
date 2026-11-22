/**
 * The MVP's "podstawowy zapis przebiegu sprawdzenia" (task sec. 3) until Supabase lands (decision 001).
 * Wraps any CheckStore and writes one JSON line per saved check to the host's log (Deno Deploy logs),
 * so the record survives restarts and instances, which the in-memory store does not.
 *
 * The line carries time, channel, input type, status, every claim's verdict or system state and the
 * cited source ids, plus a hash and the length of the masked question, but NOT the question text:
 * hosting logs cannot be deleted per session (hard constraint 12, DELETE /api/v1/session/:id). The
 * masked question stays in the wrapped store, deletable, and readable by the admin endpoint.
 */
import { sha256Hex } from "../guard/normalize.ts";
import type { CheckResponse } from "../types.ts";
import type { CheckEventRow, CheckLogRow, CheckStore } from "./types.ts";

export const AUDIT_EVENT = "prawdowid.check";

export interface AuditLine {
  event: typeof AUDIT_EVENT;
  check_id: string;
  at: string;
  channel: string;
  platform?: string;
  input_type: string;
  status: string;
  /** sha256 of the masked question: groups repeated questions without storing them. */
  input_sha256: string;
  input_chars: number;
  claims: Omit<CheckLogRow["claims"][number], "text">[];
  latency_ms: number;
  models: string[];
  prompt_versions: string[];
  cost_usd: number;
}

export async function auditLine(row: CheckLogRow): Promise<AuditLine> {
  return {
    event: AUDIT_EVENT,
    check_id: row.check_id,
    at: row.created_at,
    channel: row.channel,
    ...(row.platform ? { platform: row.platform } : {}),
    input_type: row.input_type,
    status: row.status,
    input_sha256: (await sha256Hex(row.masked_input)).slice(0, 16),
    input_chars: row.masked_input.length,
    // Claim text is derived from the question: it stays in the deletable store only.
    claims: row.claims.map(({ text: _text, ...rest }) => rest),
    latency_ms: row.latency_ms,
    models: row.models,
    prompt_versions: row.prompt_versions,
    cost_usd: row.cost_usd,
  };
}

export class LoggingCheckStore implements CheckStore {
  constructor(private inner: CheckStore, private write: (line: string) => void = (l) => console.log(l)) {}

  async saveCheck(row: CheckLogRow): Promise<void> {
    await this.inner.saveCheck(row);
    try {
      this.write(JSON.stringify(await auditLine(row)));
    } catch {
      // Logging must never change the user's answer.
    }
  }
  logEvent(row: CheckEventRow) {
    return this.inner.logEvent(row);
  }
  getCached(key: string) {
    return this.inner.getCached(key);
  }
  setCached(key: string, value: CheckResponse, sessionHash: string | null) {
    return this.inner.setCached(key, value, sessionHash);
  }
  deleteSession(sessionHash: string) {
    return this.inner.deleteSession(sessionHash);
  }
  listRecent(limit: number) {
    return this.inner.listRecent(limit);
  }
  listSince(since: Date) {
    return this.inner.listSince(since);
  }
  prune(now: Date) {
    return this.inner.prune(now);
  }
}
