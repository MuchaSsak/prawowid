import type { SourceRecord } from "../connectors/types.ts";
import { ConnectorError } from "../connectors/types.ts";
import type { CorpusStore } from "./types.ts";
import { type CollectionInfo, collectionOf } from "../sources/controls.ts";

export interface CorpusIndex {
  version: 1;
  generated_at: string;
  records: SourceRecord[];
}

function stripDiacritics(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Lightweight Polish prefix normalization, deliberately not a language-specific inflection dictionary. */
export function normalizePolish(value: string): string[] {
  return stripDiacritics(value).split(/\s+/).flatMap((token) => {
    if (!token) return [];
    let stem = token;
    for (
      const suffix of [
        "ami",
        "owi",
        "ach",
        "ego",
        "emu",
        "ych",
        "owi",
        "ami",
        "ach",
        "owi",
        "iem",
        "ów",
        "om",
        "a",
        "e",
        "i",
        "y",
        "u",
        "ą",
        "ę",
        "o",
      ]
    ) {
      if (stem.length > suffix.length + 3 && stem.endsWith(suffix)) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }
    return [stem.length >= 3 ? stem : token];
  });
}

interface Posting {
  record: SourceRecord;
  tf: number;
}

/** Keeps a record in search results; filters run while ranking, never by rebuilding an index. */
export type RecordFilter = (record: SourceRecord) => boolean;

type SearchOptions = { sources?: string[]; tiers?: string[]; dateFrom?: string; dateTo?: string };

/**
 * One BM25 index, built once when records are loaded. A search reads only the postings of the query
 * terms (inverted index), so its cost depends on how common the terms are, not on corpus size.
 */
class Bm25Index {
  private postings = new Map<string, Posting[]>();
  private lengths = new Map<string, number>();
  private byId = new Map<string, SourceRecord>();
  private avgLength = 0;

  constructor(records: SourceRecord[]) {
    let total = 0;
    for (const record of records) {
      const terms = normalizePolish(`${record.title} ${record.text}`);
      const frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      this.lengths.set(record.source_id, terms.length);
      this.byId.set(record.source_id, record);
      total += terms.length;
      for (const [term, tf] of frequencies) {
        const list = this.postings.get(term) ?? [];
        list.push({ record, tf });
        this.postings.set(term, list);
      }
    }
    this.avgLength = records.length ? total / records.length : 1;
  }

  /** Top `limit` records by BM25 among those `accept` keeps (all when omitted). */
  search(query: string, limit: number, accept?: RecordFilter): Array<{ record: SourceRecord; score: number }> {
    const terms = normalizePolish(query);
    if (!terms.length) return [];
    const scores = new Map<string, number>();
    const recordCount = this.lengths.size;
    const k1 = 1.2;
    const b = 0.75;
    for (const term of new Set(terms)) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const df = postings.length;
      const idf = Math.log(1 + (recordCount - df + 0.5) / (df + 0.5));
      for (const posting of postings) {
        const length = this.lengths.get(posting.record.source_id) ?? 1;
        const score = idf *
          ((posting.tf * (k1 + 1)) / (posting.tf + k1 * (1 - b + b * length / this.avgLength)));
        scores.set(posting.record.source_id, (scores.get(posting.record.source_id) ?? 0) + score);
      }
    }
    const ranked: Array<{ record: SourceRecord; score: number }> = [];
    for (const [id, score] of scores) {
      const record = this.byId.get(id)!;
      if (!accept || accept(record)) ranked.push({ record, score });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export class IndexedCorpusStore implements CorpusStore {
  private records: SourceRecord[] = [];
  private official = new Bm25Index([]);
  private demagog = new Bm25Index([]);
  private error: string | null = null;

  constructor(records: SourceRecord[] = []) {
    if (records.length) this.upsert(records);
  }

  /**
   * Pass a file URL (`new URL("…/alert-corpus-index.json", import.meta.url)`), not its `.pathname`:
   * on Windows the pathname is "/C:/…", which the file system rejects. A URL works on every OS.
   */
  async loadIndex(path: string | URL): Promise<void> {
    try {
      if (typeof Deno === "undefined") throw new Error("index_loading_requires_deno");
      const raw = await Deno.readTextFile(path);
      const index = JSON.parse(raw) as CorpusIndex;
      if (index.version !== 1 || !Array.isArray(index.records)) throw new Error("invalid_corpus_index");
      this.error = null;
      await this.upsert(index.records);
    } catch (error) {
      this.records = [];
      this.error = error instanceof Error ? error.message : "corpus_index_error";
      this.official = new Bm25Index([]);
      this.demagog = new Bm25Index([]);
    }
  }

  indexStatus(): { state: "ready" | "missing" | "invalid"; records: number; error?: string } {
    if (this.error) return { state: "invalid", records: 0, error: this.error };
    return this.records.length
      ? { state: "ready", records: this.records.length }
      : { state: "missing", records: 0 };
  }

  size(): number {
    return this.records.length;
  }

  /** Per-collection counts for the admin source list. */
  collections(): CollectionInfo[] {
    const byId = new Map<string, CollectionInfo>();
    for (const record of this.records) {
      const id = collectionOf(record);
      if (!id) continue;
      const c = byId.get(id) ?? { id, label: record.publisher, records: 0, latest: null };
      c.records++;
      const day = record.published_at?.slice(0, 10) ?? null;
      if (day && (!c.latest || day > c.latest)) c.latest = day;
      byId.set(id, c);
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "pl"));
  }

  upsert(records: SourceRecord[]): Promise<void> {
    const byId = new Map(this.records.map((r) => [r.source_id, r]));
    for (const record of records) byId.set(record.source_id, record);
    this.records = [...byId.values()];
    this.official = new Bm25Index(this.records.filter((r) => r.tier === "official"));
    this.demagog = new Bm25Index(this.records.filter((r) => r.tier === "factcheck"));
    return Promise.resolve();
  }

  /**
   * The same corpus with some records hidden (sources switched off by an operator). Cheap: shares the
   * built index; the filter runs during ranking. Pinned per check, so a change mid-check never mixes.
   */
  view(exclude: RecordFilter): CorpusStore & { indexStatus: IndexedCorpusStore["indexStatus"] } {
    return {
      size: () => this.size(),
      indexStatus: () => this.indexStatus(),
      upsert: (records) => this.upsert(records),
      search: (queries, limit, options, signal) => this.searchWith(queries, limit, options, signal, exclude),
    };
  }

  private matches(record: SourceRecord, options?: SearchOptions) {
    if (options?.tiers?.length && !options.tiers.includes(record.tier)) return false;
    if (options?.sources?.length) {
      const host = (() => {
        try {
          return new URL(record.url).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          return "";
        }
      })();
      if (
        !options.sources.some((source) =>
          source === record.publisher || source === record.origin_key || host === source ||
          host.endsWith(`.${source}`)
        )
      ) return false;
    }
    if ((options?.dateFrom || options?.dateTo) && !record.published_at) return false;
    if (options?.dateFrom && record.published_at!.slice(0, 10) < options.dateFrom) return false;
    if (options?.dateTo && record.published_at!.slice(0, 10) > options.dateTo) return false;
    return true;
  }

  search(queries: string[], limit: number, options?: SearchOptions, signal?: AbortSignal): Promise<SourceRecord[]> {
    return this.searchWith(queries, limit, options, signal);
  }

  private searchWith(
    queries: string[],
    limit: number,
    options: SearchOptions | undefined,
    signal: AbortSignal | undefined,
    exclude?: RecordFilter,
  ): Promise<SourceRecord[]> {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (!this.records.length) return Promise.resolve([]);
    try {
      const filtered = Boolean(options?.tiers?.length || options?.sources?.length || options?.dateFrom || options?.dateTo);
      const accept: RecordFilter | undefined = filtered || exclude
        ? (r) => (!filtered || this.matches(r, options)) && (!exclude || !exclude(r))
        : undefined;
      // Reciprocal rank fusion over the queries; official ranks before fact-checks within one query.
      const rrf = new Map<string, { record: SourceRecord; score: number }>();
      for (const query of queries) {
        const perIndex = [
          ...this.official.search(query, limit, accept),
          ...this.demagog.search(query, limit, accept),
        ];
        perIndex.forEach(({ record }, rank) => {
          const current = rrf.get(record.source_id);
          rrf.set(record.source_id, { record, score: (current?.score ?? 0) + 1 / (60 + rank + 1) });
        });
      }
      return Promise.resolve([...rrf.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.record));
    } catch (error) {
      return Promise.reject(
        error instanceof ConnectorError ? error : new ConnectorError("error", "Błąd wyszukiwania w korpusie."),
      );
    }
  }
}
