/**
 * Scheduled and manual ingestion for RSS bindings. The network fetch runs outside any lock; the
 * eligibility re-check and the corpus commit run as one step under the registry lock (the same lock
 * publish() takes), so a binding disabled while its feed was being fetched can never publish records.
 * Sync status lives here, outside the registry revision.
 */
import { contentHash, type DocumentInput, type VersionedCorpusStore } from "./corpus.ts";
import { type FetchDeps, fetchFeed } from "./adapters.ts";
import { bindingUsable, checkEligibility } from "./eligibility.ts";
import type { RegistryStore } from "./store.ts";
import type { Binding } from "./types.ts";

export interface SyncState {
  binding_id: string;
  status: "idle" | "running" | "ok" | "error" | "discarded";
  last_started_at: string | null;
  last_finished_at: string | null;
  last_ok_at: string | null;
  items: number;
  stored: number;
  unchanged: number;
  skipped: number;
  message: string | null;
}

export class Ingestor {
  readonly state = new Map<string, SyncState>();
  private timer: number | undefined;

  constructor(
    private readonly store: RegistryStore,
    private readonly corpus: VersionedCorpusStore,
    private readonly fetchDeps: FetchDeps = {},
  ) {}

  status(id: string): SyncState {
    return this.state.get(id) ?? {
      binding_id: id,
      status: "idle",
      last_started_at: null,
      last_finished_at: null,
      last_ok_at: null,
      items: 0,
      stored: 0,
      unchanged: 0,
      skipped: 0,
      message: null,
    };
  }

  private set(id: string, patch: Partial<SyncState>): SyncState {
    const s = { ...this.status(id), ...patch };
    this.state.set(id, s);
    return s;
  }

  async sync(bindingId: string, operator = "scheduler"): Promise<SyncState> {
    if (this.status(bindingId).status === "running") return this.status(bindingId);
    const reg = await this.store.read();
    const b = reg.bindings.find((x) => x.id === bindingId);
    if (!b || b.adapter !== "rss") {
      return this.set(bindingId, { status: "error", message: "to powiązanie nie jest kanałem RSS" });
    }
    if (!bindingUsable(reg, b)) {
      return this.set(bindingId, { status: "error", message: "powiązanie lub wydawca wyłączony" });
    }
    const started = new Date().toISOString();
    this.set(bindingId, { status: "running", last_started_at: started, message: null });
    try {
      const items = await fetchFeed(b, this.fetchDeps);
      const now = new Date().toISOString();
      const docs: (DocumentInput & { url: string })[] = await Promise.all(items.map(async (it) => ({
        document_id: `${b.id}:${(await contentHash(it.url)).slice(0, 16)}`,
        publisher_id: b.publisher_id!,
        binding_id: b.id,
        kind: b.doc_kind,
        title: it.title,
        canonical_url: it.url,
        url: it.url,
        published_at: it.updated_at ?? it.published_at,
        retrieved_at: now,
        effective_from: null,
        effective_to: null,
        text: it.text,
        language: "pl",
        license_status: "feed",
      })));
      // One serialized step: re-check against the active revision, then commit.
      const outcome = await this.store.exclusive(async (active) => {
        const cur = active.bindings.find((x) => x.id === b.id);
        if (!cur || !bindingUsable(active, cur) || !sameSource(cur, b)) return null;
        const ok = docs.filter((d) => {
          const e = checkEligibility(active, b.id, d.url);
          if (e.ok) d.publisher_id = e.publisher.id;
          return e.ok;
        });
        const res = await this.corpus.replace(ok.map(({ url: _u, ...d }) => d));
        return { res, skipped: docs.length - ok.length };
      });
      if (!outcome) {
        await this.store.note(
          operator,
          "sync",
          `${b.id}: odrzucono wynik, źródło wyłączone lub zmienione w trakcie pobierania`,
        );
        return this.set(bindingId, {
          status: "discarded",
          last_finished_at: new Date().toISOString(),
          items: items.length,
          stored: 0,
          unchanged: 0,
          skipped: items.length,
          message: "Źródło wyłączono lub zmieniono w trakcie pobierania; nic nie zapisano.",
        });
      }
      const stored = outcome.res.results.filter((r) => r.status !== "unchanged").length;
      if (stored) await this.store.note(operator, "sync", `${b.id}: zapisano ${stored} dokumentów`);
      return this.set(bindingId, {
        status: "ok",
        last_finished_at: new Date().toISOString(),
        last_ok_at: new Date().toISOString(),
        items: items.length,
        stored,
        unchanged: outcome.res.results.length - stored,
        skipped: outcome.skipped,
        message: outcome.skipped ? `${outcome.skipped} wpisów poza zakresem wydawcy` : null,
      });
    } catch (err) {
      return this.set(bindingId, {
        status: "error",
        last_finished_at: new Date().toISOString(),
        message: (err as Error).message,
      });
    }
  }

  /** Every tick, sync active RSS bindings whose interval has passed. Returns a stop function. */
  start(tickMs = 60_000): () => void {
    const tick = async () => {
      let reg;
      try {
        reg = await this.store.read();
      } catch {
        return;
      }
      for (const b of reg.bindings) {
        if (b.adapter !== "rss" || !bindingUsable(reg, b)) continue;
        const every = (Number(b.config.interval_minutes) || 60) * 60_000;
        const last = this.status(b.id).last_started_at;
        if (!last || Date.now() - Date.parse(last) >= every) await this.sync(b.id).catch(() => {});
      }
    };
    this.timer = setInterval(tick, tickMs);
    void tick();
    return () => clearInterval(this.timer);
  }
}

function sameSource(a: Binding, b: Binding): boolean {
  return JSON.stringify([a.config, a.allowed_hosts, a.publisher_id]) ===
    JSON.stringify([b.config, b.allowed_hosts, b.publisher_id]);
}
