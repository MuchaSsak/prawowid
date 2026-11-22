/**
 * Where the source switches live (packages/core/src/sources/controls.ts). Deno KV when the runtime
 * has it (Deno Deploy with a KV database attached, or `deno run --unstable-kv`): one shared state for
 * every instance, kept across restarts. Otherwise memory: this instance only, back to all-on after a
 * restart. The admin page shows which one is in use.
 */
import { EMPTY_SOURCE_CONTROLS, setSourceEnabled, type SourceControlState } from "@prawdowid/core";

export interface SourceControlStore {
  readonly persistence: "kv" | "memory";
  read(): Promise<SourceControlState>;
  set(key: string, enabled: boolean): Promise<SourceControlState>;
}

const KV_KEY = ["prawdowid", "source_controls"];

/** The part of Deno.Kv we use (Deno.Kv types are unstable-only, so the API typechecks without them). */
interface KvEntry<T> {
  value: T | null;
  versionstamp: string | null;
}
interface MiniKv {
  get<T>(key: string[]): Promise<KvEntry<T>>;
  atomic(): {
    check(entry: KvEntry<unknown>): ReturnType<MiniKv["atomic"]>;
    set(key: string[], value: unknown): ReturnType<MiniKv["atomic"]>;
    commit(): Promise<{ ok: boolean }>;
  };
}

export class MemorySourceControlStore implements SourceControlStore {
  readonly persistence = "memory" as const;
  private state: SourceControlState = EMPTY_SOURCE_CONTROLS;
  read() {
    return Promise.resolve(this.state);
  }
  set(key: string, enabled: boolean) {
    this.state = setSourceEnabled(this.state, key, enabled);
    return Promise.resolve(this.state);
  }
}

export class KvSourceControlStore implements SourceControlStore {
  readonly persistence = "kv" as const;
  constructor(private kv: MiniKv) {}
  async read() {
    return (await this.kv.get<SourceControlState>(KV_KEY)).value ?? EMPTY_SOURCE_CONTROLS;
  }
  async set(key: string, enabled: boolean) {
    // Optimistic concurrency: two operators saving at once never lose a change.
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await this.kv.get<SourceControlState>(KV_KEY);
      const next = setSourceEnabled(entry.value ?? EMPTY_SOURCE_CONTROLS, key, enabled);
      const res = await this.kv.atomic().check(entry).set(KV_KEY, next).commit();
      if (res.ok) return next;
    }
    throw new Error("source controls: concurrent update, try again");
  }
}

/** KV when available, else memory. Never throws. */
export async function openSourceControlStore(): Promise<SourceControlStore> {
  try {
    const open = (Deno as unknown as { openKv?: () => Promise<MiniKv> }).openKv;
    if (typeof open === "function") return new KvSourceControlStore(await open.call(Deno));
  } catch {
    // No KV in this runtime (local run without --unstable-kv, or no database attached).
  }
  return new MemorySourceControlStore();
}
