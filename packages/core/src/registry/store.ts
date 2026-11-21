/**
 * Registry storage. publish() validates the next content and bumps the revision in one serialized
 * step, then appends an audit entry. The file store writes a temp file and renames it, so a reader
 * sees either the old or the new revision. A missing file is seeded once at init(); a corrupt or
 * unreadable file never falls back to the seed: read() throws and checks get a retryable state.
 * Production would put the same state in server-only Supabase tables (architecture/source-platform.md).
 */
import { validateRegistry } from "./validate.ts";
import {
  type AuditEntry,
  type Draft,
  type Registry,
  type RegistryContent,
  type RegistryState,
  RegistryUnavailableError,
  RegistryValidationError,
} from "./types.ts";

const AUDIT_KEEP = 500;

/** Serializes async sections (registry publish, ingestion commit). Not re-entrant. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

export interface RegistryStore {
  readonly kind: "memory" | "file";
  /** Seeds the store when (and only when) nothing exists yet. */
  init(seed: () => RegistryContent, operator?: string): Promise<{ seeded: boolean }>;
  /** The active revision. Throws RegistryUnavailableError; never returns the seed. */
  read(): Promise<Registry>;
  /** Runs fn under the same lock as publish(), with the active revision read inside the lock. */
  exclusive<T>(fn: (reg: Registry) => Promise<T>): Promise<T>;
  /** Validates, bumps the revision, writes atomically, appends an audit entry. */
  publish(
    operator: string,
    action: string,
    detail: string,
    mutate: (next: RegistryContent) => void,
  ): Promise<Registry>;
  /** Audit entries that do not change the revision (drafts, syncs, uploads). */
  note(operator: string, action: string, detail: string): Promise<void>;
  audit(limit: number): Promise<AuditEntry[]>;
  listDrafts(): Promise<Draft[]>;
  getDraft(id: string): Promise<Draft | null>;
  saveDraft(d: Draft): Promise<void>;
  deleteDraft(id: string): Promise<boolean>;
}

function content(r: Registry): RegistryContent {
  return structuredClone({ publishers: r.publishers, bindings: r.bindings, links: r.links });
}

abstract class StateStore implements RegistryStore {
  abstract readonly kind: "memory" | "file";
  protected lock = new Mutex();
  protected abstract load(): Promise<RegistryState>;
  protected abstract save(s: RegistryState): Promise<void>;
  protected abstract exists(): Promise<boolean>;

  async init(seed: () => RegistryContent, operator = "system") {
    return await this.lock.run(async () => {
      if (await this.exists()) return { seeded: false };
      const c = seed();
      const errors = validateRegistry(c);
      if (errors.length) throw new RegistryValidationError(errors);
      const at = new Date().toISOString();
      await this.save({
        registry: { ...c, revision: 1, published_at: at, published_by: operator },
        drafts: [],
        audit: [{
          at,
          operator,
          action: "seed",
          revision: 1,
          detail: "rejestr utworzony z katalogu w kodzie",
        }],
      });
      return { seeded: true };
    });
  }

  async read() {
    return (await this.load()).registry;
  }

  exclusive<T>(fn: (reg: Registry) => Promise<T>) {
    return this.lock.run(async () => fn((await this.load()).registry));
  }

  publish(operator: string, action: string, detail: string, mutate: (next: RegistryContent) => void) {
    return this.lock.run(async () => {
      const s = await this.load();
      const next = content(s.registry);
      mutate(next);
      const errors = validateRegistry(next);
      if (errors.length) throw new RegistryValidationError(errors);
      const at = new Date().toISOString();
      const registry: Registry = {
        ...next,
        revision: s.registry.revision + 1,
        published_at: at,
        published_by: operator,
      };
      s.registry = registry;
      s.audit = [...s.audit, { at, operator, action, revision: registry.revision, detail }].slice(
        -AUDIT_KEEP,
      );
      await this.save(s);
      return registry;
    });
  }

  note(operator: string, action: string, detail: string) {
    return this.lock.run(async () => {
      const s = await this.load();
      s.audit = [...s.audit, {
        at: new Date().toISOString(),
        operator,
        action,
        revision: s.registry.revision,
        detail,
      }]
        .slice(-AUDIT_KEEP);
      await this.save(s);
    });
  }

  async audit(limit: number) {
    return (await this.load()).audit.slice(-limit).reverse();
  }
  async listDrafts() {
    return (await this.load()).drafts;
  }
  async getDraft(id: string) {
    return (await this.load()).drafts.find((d) => d.id === id) ?? null;
  }
  saveDraft(d: Draft) {
    return this.lock.run(async () => {
      const s = await this.load();
      s.drafts = [...s.drafts.filter((x) => x.id !== d.id), d];
      await this.save(s);
    });
  }
  deleteDraft(id: string) {
    return this.lock.run(async () => {
      const s = await this.load();
      const before = s.drafts.length;
      s.drafts = s.drafts.filter((x) => x.id !== id);
      await this.save(s);
      return s.drafts.length < before;
    });
  }
}

export class MemoryRegistryStore extends StateStore {
  readonly kind = "memory";
  private state: RegistryState | null = null;
  /** Tests: simulate an unreadable registry. */
  failReads = false;
  protected exists() {
    return Promise.resolve(this.state !== null);
  }
  protected load() {
    if (this.failReads) {
      return Promise.reject(new RegistryUnavailableError("unreadable", "rejestr niedostępny (test)"));
    }
    if (!this.state) return Promise.reject(new RegistryUnavailableError("missing", "rejestr nie istnieje"));
    return Promise.resolve(structuredClone(this.state));
  }
  protected save(s: RegistryState) {
    this.state = structuredClone(s);
    return Promise.resolve();
  }
}

/** Writes JSON to a temp file next to the target, then renames it over the target (atomic on one filesystem). */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  await Deno.mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp-${crypto.randomUUID().slice(0, 8)}`;
  await Deno.writeTextFile(tmp, JSON.stringify(data, null, 2));
  await Deno.rename(tmp, path);
}

function looksLikeState(x: unknown): x is RegistryState {
  const s = x as RegistryState;
  return Boolean(
    s && typeof s === "object" && s.registry && typeof s.registry.revision === "number" &&
      Array.isArray(s.registry.publishers) && Array.isArray(s.registry.bindings) &&
      Array.isArray(s.registry.links) &&
      Array.isArray(s.drafts) && Array.isArray(s.audit),
  );
}

export class FileRegistryStore extends StateStore {
  readonly kind = "file";
  constructor(readonly path: string) {
    super();
  }
  protected async exists() {
    try {
      await Deno.stat(this.path);
      return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return false;
      throw err;
    }
  }
  protected async load(): Promise<RegistryState> {
    let raw: string;
    try {
      raw = await Deno.readTextFile(this.path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new RegistryUnavailableError("missing", `brak pliku rejestru ${this.path}`);
      }
      throw new RegistryUnavailableError(
        "unreadable",
        `nie można odczytać rejestru: ${(err as Error).message}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RegistryUnavailableError("corrupt", "plik rejestru jest uszkodzony (nieprawidłowy JSON)");
    }
    if (!looksLikeState(parsed)) {
      throw new RegistryUnavailableError("corrupt", "plik rejestru ma nieprawidłową strukturę");
    }
    return parsed;
  }
  protected save(s: RegistryState) {
    return writeJsonAtomic(this.path, s);
  }
}
