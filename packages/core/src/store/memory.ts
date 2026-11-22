/**
 * In-memory mock of the database. Lost on restart; good enough to build and demo the flow before
 * Supabase. Same interfaces as the future Supabase adapter (store/types.ts).
 */
import { LIMITS } from "../config.ts";
import type { SourceRecord } from "../connectors/types.ts";
import { tokens } from "../guard/normalize.ts";
import type { CheckResponse } from "../types.ts";
import type { CheckEventRow, CheckLogRow, CheckStore, CorpusStore } from "./types.ts";

export class MemoryCheckStore implements CheckStore {
  checks: CheckLogRow[] = [];
  events: CheckEventRow[] = [];
  private cache = new Map<string, { value: CheckResponse; at: number; sessions: Set<string> }>();

  saveCheck(row: CheckLogRow) {
    this.checks.push(row);
    return Promise.resolve();
  }
  logEvent(row: CheckEventRow) {
    this.events.push(row);
    return Promise.resolve();
  }
  getCached(key: string) {
    const hit = this.cache.get(key);
    if (!hit || Date.now() - hit.at > LIMITS.cacheTtlMs) {
      this.cache.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(hit.value);
  }
  setCached(key: string, value: CheckResponse, sessionHash: string | null) {
    const entry = this.cache.get(key) ?? { value, at: Date.now(), sessions: new Set<string>() };
    if (sessionHash) entry.sessions.add(sessionHash);
    this.cache.set(key, entry);
    return Promise.resolve();
  }
  deleteSession(sessionHash: string) {
    const ids = new Set(this.checks.filter((c) => c.session_hash === sessionHash).map((c) => c.check_id));
    this.checks = this.checks.filter((c) => !ids.has(c.check_id));
    this.events = this.events.filter((e) => !ids.has(e.check_id));
    for (const [k, v] of this.cache) if (v.sessions.has(sessionHash)) this.cache.delete(k);
    return Promise.resolve({ checks: ids.size });
  }
  listRecent(limit: number) {
    return Promise.resolve(this.checks.slice(-limit).reverse());
  }
  listSince(since: Date) {
    const t = since.getTime();
    return Promise.resolve({
      checks: this.checks.filter((c) => Date.parse(c.created_at) > t),
      events: this.events.filter((e) => Date.parse(e.created_at) > t),
    });
  }
  prune(now: Date) {
    const cutoff = now.getTime() - LIMITS.retentionDays * 86_400_000;
    this.checks = this.checks.filter((c) => Date.parse(c.created_at) >= cutoff);
    this.events = this.events.filter((e) => Date.parse(e.created_at) >= cutoff);
    // Cached answers expire after the TTL; a key never read again would otherwise stay in memory.
    for (const [k, v] of this.cache) if (now.getTime() - v.at > LIMITS.cacheTtlMs) this.cache.delete(k);
    return Promise.resolve();
  }
}

/** Keyword-overlap search over records added with upsert(). Empty by default (no fabricated sources). */
export class MemoryCorpusStore implements CorpusStore {
  private records: SourceRecord[] = [];
  size() {
    return this.records.length;
  }
  upsert(records: SourceRecord[]) {
    const byId = new Map(this.records.map((r) => [r.source_id, r]));
    for (const r of records) byId.set(r.source_id, r);
    this.records = [...byId.values()];
    return Promise.resolve();
  }
  search(queries: string[], limit: number) {
    const q = new Set(queries.flatMap(tokens));
    const scored = this.records
      .map((r) => ({ r, s: tokens(`${r.title} ${r.text}`).filter((t) => q.has(t)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit);
    return Promise.resolve(scored.map((x) => x.r));
  }
}
