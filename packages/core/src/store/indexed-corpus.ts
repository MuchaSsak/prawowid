import type { SourceRecord } from "../connectors/types.ts";
import { ConnectorError } from "../connectors/types.ts";
import type { CorpusStore } from "./types.ts";

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

class Bm25Index {
  private postings = new Map<string, Posting[]>();
  private lengths = new Map<string, number>();
  private avgLength = 0;

  constructor(records: SourceRecord[]) {
    let total = 0;
    for (const record of records) {
      const terms = normalizePolish(`${record.title} ${record.text}`);
      const frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      this.lengths.set(record.source_id, terms.length);
      total += terms.length;
      for (const [term, tf] of frequencies) {
        const list = this.postings.get(term) ?? [];
        list.push({ record, tf });
        this.postings.set(term, list);
      }
    }
    this.avgLength = records.length ? total / records.length : 1;
  }

  search(query: string, limit: number): Array<{ record: SourceRecord; score: number }> {
    const terms = normalizePolish(query);
    if (!terms.length) return [];
    const scores = new Map<string, number>();
    const recordCount = [...this.lengths.keys()].length;
    for (const term of new Set(terms)) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const df = postings.length;
      const idf = Math.log(1 + (recordCount - df + 0.5) / (df + 0.5));
      for (const posting of postings) {
        const length = this.lengths.get(posting.record.source_id) ?? 1;
        const k1 = 1.2;
        const b = 0.75;
        const score = idf *
          ((posting.tf * (k1 + 1)) / (posting.tf + k1 * (1 - b + b * length / this.avgLength)));
        scores.set(posting.record.source_id, (scores.get(posting.record.source_id) ?? 0) + score);
      }
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({
        record: [...this.postings.values()].flat().find((p) => p.record.source_id === id)!.record,
        score,
      }));
  }
}

export class IndexedCorpusStore implements CorpusStore {
  private records: SourceRecord[] = [];
  private official = new Bm25Index([]);
  private demagog = new Bm25Index([]);
  private error: string | null = null;
  private readonly timeoutMs = 2000;

  constructor(records: SourceRecord[] = []) {
    if (records.length) this.upsert(records);
  }

  async loadIndex(path: string): Promise<void> {
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

  upsert(records: SourceRecord[]): Promise<void> {
    const byId = new Map(this.records.map((r) => [r.source_id, r]));
    for (const record of records) byId.set(record.source_id, record);
    this.records = [...byId.values()];
    this.official = new Bm25Index(this.records.filter((r) => r.tier === "official"));
    this.demagog = new Bm25Index(this.records.filter((r) => r.tier === "factcheck"));
    return Promise.resolve();
  }

  private matches(
    record: SourceRecord,
    options?: { sources?: string[]; tiers?: string[]; dateFrom?: string; dateTo?: string },
  ) {
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

  async search(
    queries: string[],
    limit: number,
    options?: { sources?: string[]; tiers?: string[]; dateFrom?: string; dateTo?: string },
    signal?: AbortSignal,
  ): Promise<SourceRecord[]> {
    if (!this.records.length) return [];
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const searchWork = () => {
      const allowed = this.records.filter((record) => this.matches(record, options));
      if (!allowed.length) return [];
      const allowedIds = new Set(allowed.map((r) => r.source_id));
      const filteredOfficial = new Bm25Index(allowed.filter((r) => r.tier === "official"));
      const filteredDemagog = new Bm25Index(allowed.filter((r) => r.tier === "factcheck"));
      const rrf = new Map<string, { record: SourceRecord; score: number }>();
      for (const query of queries) {
        const perIndex = [
          ...filteredOfficial.search(query, limit),
          ...filteredDemagog.search(query, limit),
        ];
        perIndex.forEach(({ record }, rank) => {
          if (!allowedIds.has(record.source_id)) return;
          const current = rrf.get(record.source_id);
          rrf.set(record.source_id, { record, score: (current?.score ?? 0) + 1 / (60 + rank + 1) });
        });
      }
      return [...rrf.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.record);
    };
    let timer: number | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(searchWork),
        new Promise<SourceRecord[]>((_, reject) => {
          timer = setTimeout(() => reject(new Error("corpus_search_timeout")), this.timeoutMs);
        }),
        signal
          ? new Promise<SourceRecord[]>((_, reject) =>
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            })
          )
          : new Promise<SourceRecord[]>(() => {}),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === "corpus_search_timeout") {
        throw new ConnectorError("timeout", "Przekroczono limit czasu wyszukiwania w korpusie.");
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
