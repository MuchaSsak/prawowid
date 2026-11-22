/**
 * Where the check log lives until Supabase lands (decision 001). Deno KV when the runtime has it
 * (Deno Deploy, or `deno run --unstable-kv`): one log for every instance, kept across restarts and
 * redeploys, so the admin analytics see every check. The in-memory store alone saw only the checks
 * of the one isolate that answered the admin call, and lost them on every restart.
 *
 * Rows expire after the retention period (LIMITS.retentionDays) on their own. The short answer cache
 * stays in memory: it is only a per-instance speed-up.
 */
import { type CheckLogRow, type CheckResponse, type CheckStore, LIMITS, MemoryCheckStore } from "@prawdowid/core";

type CheckEventRow = Parameters<CheckStore["logEvent"]>[0];
type Key = (string | number)[];

/** The part of Deno.Kv we use (Deno.Kv types are unstable-only, so the API typechecks without them). */
interface KvList<T> extends AsyncIterable<{ key: Key; value: T }> {}
interface CheckKv {
  set(key: Key, value: unknown, options?: { expireIn?: number }): Promise<unknown>;
  delete(key: Key): Promise<void>;
  list<T>(selector: { prefix?: Key; start?: Key; end?: Key }, options?: { reverse?: boolean; limit?: number }): KvList<T>;
}

const ROOT = "prawdowid";
const CHECK = [ROOT, "check"];
const EVENT = [ROOT, "check_event"];
const SESSION = [ROOT, "check_session"];
/** Sorts after every ISO timestamp. */
const END = "￿";

export class KvCheckStore implements CheckStore {
  readonly persistence = "kv" as const;
  private cache = new MemoryCheckStore();
  private seq = 0;
  constructor(private kv: CheckKv) {}

  private get expireIn() {
    return LIMITS.retentionDays * 86_400_000;
  }

  async saveCheck(row: CheckLogRow) {
    await this.kv.set([...CHECK, row.created_at, row.check_id], row, { expireIn: this.expireIn });
    if (row.session_hash) {
      await this.kv.set([...SESSION, row.session_hash, row.check_id], row.created_at, { expireIn: this.expireIn });
    }
  }
  async logEvent(row: CheckEventRow) {
    await this.kv.set([...EVENT, row.created_at, row.check_id, this.seq++], row, { expireIn: this.expireIn });
  }
  getCached(key: string) {
    return this.cache.getCached(key);
  }
  setCached(key: string, value: CheckResponse, sessionHash: string | null) {
    return this.cache.setCached(key, value, sessionHash);
  }
  async deleteSession(sessionHash: string) {
    const ids = new Set<string>();
    for await (const e of this.kv.list<string>({ prefix: [...SESSION, sessionHash] })) {
      const id = String(e.key[e.key.length - 1]);
      ids.add(id);
      await this.kv.delete([...CHECK, e.value, id]);
      await this.kv.delete(e.key);
    }
    if (ids.size) {
      for await (const e of this.kv.list<CheckEventRow>({ prefix: EVENT })) {
        if (ids.has(e.value.check_id)) await this.kv.delete(e.key);
      }
    }
    await this.cache.deleteSession(sessionHash);
    return { checks: ids.size };
  }
  async listRecent(limit: number) {
    const rows: CheckLogRow[] = [];
    for await (const e of this.kv.list<CheckLogRow>({ prefix: CHECK }, { reverse: true, limit })) rows.push(e.value);
    return rows;
  }
  async listSince(since: Date) {
    const from = since.toISOString();
    const checks: CheckLogRow[] = [];
    const events: CheckEventRow[] = [];
    for await (const e of this.kv.list<CheckLogRow>({ start: [...CHECK, from], end: [...CHECK, END] })) {
      if (e.value.created_at > from) checks.push(e.value);
    }
    for await (const e of this.kv.list<CheckEventRow>({ start: [...EVENT, from], end: [...EVENT, END] })) {
      if (e.value.created_at > from) events.push(e.value);
    }
    return { checks, events };
  }
  /** KV drops expired rows itself; only the in-memory cache needs a sweep. */
  prune(now: Date) {
    return this.cache.prune(now);
  }
}

/** KV when available, else memory (this instance only, lost on restart). Never throws. */
export async function openCheckStore(): Promise<CheckStore & { persistence: "kv" | "memory" }> {
  try {
    const open = (Deno as unknown as { openKv?: () => Promise<CheckKv> }).openKv;
    if (typeof open === "function") return new KvCheckStore(await open.call(Deno));
  } catch {
    // No KV in this runtime (local run without --unstable-kv, or no database attached).
  }
  return Object.assign(new MemoryCheckStore(), { persistence: "memory" as const });
}
