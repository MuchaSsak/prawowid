/**
 * Versioned, registry-aware corpus. Two backends implement it: pgvector through the Python retrieval
 * service (store/http-corpus.ts, the real search) and this in-memory keyword store (no Docker needed).
 * Both follow the same rules (contract in architecture/source-platform.md, prototype section):
 *  - replace(): index the new version, mark it current and supersede the old one in one step that
 *    bumps the corpus revision;
 *  - query(): filter by active publisher and binding ids and by the version rule BEFORE ranking;
 *  - dated_statement: always the current version; standing_state: for checks about today the current,
 *    effective version (stale past the binding's freshness rule), for historical checks the version
 *    that covered the claim period.
 */
import { tokens } from "../guard/normalize.ts";
import { writeJsonAtomic } from "./store.ts";
import type { DocKind } from "./types.ts";

export type VersionStatus = "current" | "superseded";

export interface DocumentInput {
  document_id: string;
  publisher_id: string;
  binding_id: string;
  kind: DocKind;
  title: string;
  canonical_url: string;
  published_at: string | null;
  retrieved_at: string;
  effective_from: string | null;
  effective_to: string | null;
  text: string;
  language?: string;
  license_status?: string;
  test_data?: boolean;
}

export interface DocumentVersion {
  document_id: string;
  version: number;
  publisher_id: string | null;
  binding_id: string | null;
  kind: DocKind;
  status: VersionStatus;
  title: string;
  canonical_url: string;
  published_at: string | null;
  retrieved_at: string;
  effective_from: string | null;
  effective_to: string | null;
  superseded_at: string | null;
  content_hash: string;
  chars: number;
  test_data: boolean;
  text?: string;
}

export type ReplaceStatus = "new" | "changed" | "unchanged" | "adopted";

export interface ReplaceResult {
  results: { document_id: string; version: number; status: ReplaceStatus }[];
  corpus_revision: number;
}

export interface ClaimPeriod {
  start: string;
  end: string;
}

export interface CorpusQuery {
  query: string;
  k: number;
  publisher_ids: string[];
  binding_ids: string[];
  mode: "today" | "historical";
  today: string;
  claim_period?: ClaimPeriod;
  freshness: { binding_id: string; days: number }[];
}

export interface CorpusHit {
  chunk_id: string;
  document_id: string;
  version: number;
  publisher_id: string;
  binding_id: string;
  kind: DocKind;
  status: VersionStatus;
  title: string;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  effective_from: string | null;
  effective_to: string | null;
  quoted_text: string;
  score: number;
  stale: boolean;
}

export interface CorpusListFilter {
  publisher_id?: string;
  binding_id?: string;
  q?: string;
  date?: string;
  include_superseded?: boolean;
  limit?: number;
}

export interface VersionedCorpusStore {
  readonly backend: "memory" | "pgvector";
  revision(): Promise<number>;
  replace(docs: DocumentInput[]): Promise<ReplaceResult>;
  query(q: CorpusQuery): Promise<{ hits: CorpusHit[]; corpus_revision: number }>;
  list(f: CorpusListFilter): Promise<{ documents: DocumentVersion[]; corpus_revision: number }>;
  history(documentId: string): Promise<DocumentVersion[] | null>;
}

// ── Shared date rules ────────────────────────────────────────────────────────

const DAY = 86_400_000;
export const isoDay = (iso: string) => iso.slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Claim time ("2024", "2024-03", "2024-03-05", "unknown") → mode and period. Covering today = today. */
export function claimWindow(
  time: string,
  today: string,
): { mode: "today" | "historical"; period?: ClaimPeriod } {
  const m = time?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return { mode: "today" };
  const [, y, mo, d] = m;
  let start: string, end: string;
  if (d) start = end = `${y}-${mo}-${d}`;
  else if (mo) {
    start = `${y}-${mo}-01`;
    end = addDays(
      `${mo === "12" ? Number(y) + 1 : y}-${mo === "12" ? "01" : String(Number(mo) + 1).padStart(2, "0")}-01`,
      -1,
    );
  } else {
    start = `${y}-01-01`;
    end = `${y}-12-31`;
  }
  if (end >= today) return { mode: "today" };
  return { mode: "historical", period: { start, end } };
}

export function validFrom(
  v: Pick<DocumentVersion, "effective_from" | "published_at" | "retrieved_at">,
): string {
  return v.effective_from ?? isoDay(v.published_at ?? v.retrieved_at);
}

/** Valid-to of each version: its own effective_to, else the day before the next version starts. */
function validTo(v: DocumentVersion, next: DocumentVersion | undefined): string | null {
  return v.effective_to ?? (next ? addDays(validFrom(next), -1) : null);
}

export function isStale(
  v: Pick<DocumentVersion, "kind" | "binding_id" | "published_at" | "retrieved_at">,
  today: string,
  freshness: CorpusQuery["freshness"],
): boolean {
  if (v.kind !== "standing_state") return false;
  const rule = freshness.find((f) => f.binding_id === v.binding_id);
  if (!rule) return false;
  const updated = Date.parse(`${isoDay(v.published_at ?? v.retrieved_at)}T00:00:00Z`);
  return (Date.parse(`${today}T00:00:00Z`) - updated) / DAY > rule.days;
}

/** Picks the version a check may use, per document (versions ascending), or null. */
export function selectVersion(
  versions: DocumentVersion[],
  q: Pick<CorpusQuery, "mode" | "today" | "claim_period">,
): DocumentVersion | null {
  const current = versions.find((v) => v.status === "current") ?? null;
  if (!current) return null;
  if (current.kind === "dated_statement") return current;
  if (q.mode === "today") {
    if (validFrom(current) > q.today) return null;
    if (current.effective_to && current.effective_to < q.today) return null;
    return current;
  }
  const p = q.claim_period!;
  let pick: DocumentVersion | null = null;
  versions.forEach((v, i) => {
    const to = validTo(v, versions[i + 1]);
    if (validFrom(v) <= p.end && (to === null || to >= p.start)) pick = v;
  });
  return pick;
}

export async function contentHash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sentence-packed chunks of ≤ max chars, each a literal slice of the text. */
export function chunkText(text: string, max = 700): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let cur: { start: number; end: number } | null = null;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const start = m.index! + lead;
    const end = m.index! + raw.trimEnd().length;
    if (end <= start) continue;
    if (cur && end - cur.start > max) {
      out.push({ text: text.slice(cur.start, cur.end), ...cur });
      cur = null;
    }
    cur = cur ? { start: cur.start, end } : { start, end };
  }
  if (cur) out.push({ text: text.slice(cur.start, cur.end), ...cur });
  return out;
}

const SAME_META = [
  "publisher_id",
  "binding_id",
  "kind",
  "title",
  "canonical_url",
  "published_at",
  "effective_from",
  "effective_to",
] as const;

// ── In-memory backend (keyword ranking), optionally persisted to a JSON file ──

/** Polish inflection: compare 6-letter stems. Prototype only; pgvector is the real search. */
const stems = (t: string) => tokens(t).map((w) => w.slice(0, 6));

export class MemoryVersionedCorpus implements VersionedCorpusStore {
  readonly backend = "memory";
  private docs = new Map<string, DocumentVersion[]>();
  private rev = 0;
  private loaded = false;

  constructor(private readonly path?: string) {}

  private async ensure() {
    if (this.loaded || !this.path) return;
    this.loaded = true;
    try {
      const s = JSON.parse(await Deno.readTextFile(this.path)) as {
        revision: number;
        docs: DocumentVersion[];
      };
      this.rev = s.revision;
      for (const v of s.docs) this.docs.set(v.document_id, [...(this.docs.get(v.document_id) ?? []), v]);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  private async persist() {
    if (!this.path) return;
    await writeJsonAtomic(this.path, { revision: this.rev, docs: [...this.docs.values()].flat() });
  }

  async revision() {
    await this.ensure();
    return this.rev;
  }

  /** One synchronous commit after all hashes are computed: the batch lands at once with one revision bump. */
  async replace(inputs: DocumentInput[]): Promise<ReplaceResult> {
    await this.ensure();
    const prepared = await Promise.all(inputs.map(async (d) => ({ d, hash: await contentHash(d.text) })));
    const results: ReplaceResult["results"] = [];
    const at = new Date().toISOString();
    let changed = false;
    for (const { d, hash } of prepared) {
      const versions = this.docs.get(d.document_id) ?? [];
      const cur = versions.find((v) => v.status === "current");
      const fresh = (version: number): DocumentVersion => ({
        document_id: d.document_id,
        version,
        publisher_id: d.publisher_id,
        binding_id: d.binding_id,
        kind: d.kind,
        status: "current",
        title: d.title,
        canonical_url: d.canonical_url,
        published_at: d.published_at,
        retrieved_at: d.retrieved_at,
        effective_from: d.effective_from,
        effective_to: d.effective_to,
        superseded_at: null,
        content_hash: hash,
        chars: d.text.length,
        test_data: Boolean(d.test_data),
        text: d.text,
      });
      if (!cur) {
        this.docs.set(d.document_id, [...versions, fresh(1)]);
        results.push({ document_id: d.document_id, version: 1, status: "new" });
        changed = true;
      } else if (cur.content_hash === hash && SAME_META.every((k) => cur[k] === d[k])) {
        results.push({ document_id: d.document_id, version: cur.version, status: "unchanged" });
      } else if (cur.content_hash === hash && cur.publisher_id === null) {
        Object.assign(cur, { publisher_id: d.publisher_id, binding_id: d.binding_id, kind: d.kind });
        results.push({ document_id: d.document_id, version: cur.version, status: "adopted" });
        changed = true;
      } else {
        const version = Math.max(...versions.map((v) => v.version)) + 1;
        cur.status = "superseded";
        cur.superseded_at = at;
        this.docs.set(d.document_id, [...versions, fresh(version)]);
        results.push({ document_id: d.document_id, version, status: "changed" });
        changed = true;
      }
    }
    if (changed) {
      this.rev++;
      await this.persist();
    }
    return { results, corpus_revision: this.rev };
  }

  async query(q: CorpusQuery) {
    await this.ensure();
    const pubs = new Set(q.publisher_ids);
    const binds = new Set(q.binding_ids);
    const terms = new Set(stems(q.query));
    const hits: CorpusHit[] = [];
    for (const versions of this.docs.values()) {
      // Filter first (publisher, binding, version rule), rank after.
      const v = selectVersion(versions, q);
      if (!v || !v.publisher_id || !v.binding_id || !pubs.has(v.publisher_id) || !binds.has(v.binding_id)) {
        continue;
      }
      const text = v.text ?? "";
      for (const [i, c] of chunkText(text).entries()) {
        const words = new Set(stems(`${v.title} ${c.text}`));
        let s = 0;
        for (const t of terms) if (words.has(t)) s++;
        if (s === 0) continue;
        hits.push({
          chunk_id: `${v.document_id}:${v.version}:${i}`,
          document_id: v.document_id,
          version: v.version,
          publisher_id: v.publisher_id,
          binding_id: v.binding_id,
          kind: v.kind,
          status: v.status,
          title: v.title,
          url: v.canonical_url,
          published_at: v.published_at,
          retrieved_at: v.retrieved_at,
          effective_from: v.effective_from,
          effective_to: v.effective_to,
          quoted_text: c.text,
          score: s / Math.max(3, terms.size),
          stale: q.mode === "today" && isStale(v, q.today, q.freshness),
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.chunk_id.localeCompare(b.chunk_id));
    return { hits: hits.slice(0, q.k), corpus_revision: this.rev };
  }

  async list(f: CorpusListFilter) {
    await this.ensure();
    const q = f.q?.toLowerCase();
    const out: DocumentVersion[] = [];
    for (const versions of this.docs.values()) {
      versions.forEach((v, i) => {
        if (!f.include_superseded && v.status !== "current") return;
        if (f.publisher_id && v.publisher_id !== f.publisher_id) return;
        if (f.binding_id && v.binding_id !== f.binding_id) return;
        if (q && !`${v.title} ${v.text ?? ""}`.toLowerCase().includes(q)) return;
        if (f.date) {
          const to = validTo(v, versions[i + 1]);
          if (validFrom(v) > f.date || (to !== null && to < f.date)) return;
        }
        const { text: _t, ...meta } = v;
        out.push(meta);
      });
    }
    out.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "") || b.version - a.version);
    return { documents: out.slice(0, Math.min(f.limit ?? 100, 500)), corpus_revision: this.rev };
  }

  async history(documentId: string) {
    await this.ensure();
    const v = this.docs.get(documentId);
    return v ? [...v].reverse().map((x) => ({ ...x })) : null;
  }
}
