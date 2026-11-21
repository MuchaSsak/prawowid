import type { SourceRecord } from "../connectors/types.ts";
import type {
  CorpusHit,
  CorpusListFilter,
  CorpusQuery,
  DocumentInput,
  DocumentVersion,
  ReplaceResult,
  VersionedCorpusStore,
} from "../registry/corpus.ts";
import type { CorpusStore } from "./types.ts";

type RetrievalItem = {
  chunk_id?: string;
  document_id?: string;
  document_version?: number;
  title?: string | null;
  publisher?: string | null;
  url?: string;
  published_at?: string | null;
  retrieved_at?: string | null;
  quoted_text?: string;
  start_offset?: number;
  end_offset?: number;
  score?: number;
  // Registry mode (versioned corpus contract)
  publisher_id?: string | null;
  binding_id?: string | null;
  kind?: "dated_statement" | "standing_state";
  status?: "current" | "superseded";
  effective_from?: string | null;
  effective_to?: string | null;
  stale?: boolean;
};

type RetrievalResult = {
  results?: RetrievalItem[];
  corpus_revision?: number;
  errors?: Array<{ code?: string; message?: string }>;
};

/**
 * Adapter for the Python + pgvector retrieval service (scripts/api.py). Two faces:
 * - CorpusStore (legacy): plain search used before the registry existed;
 * - VersionedCorpusStore: the registry-aware corpus (filters before vector ranking, versions, revision).
 * Embeddings are computed in Python; this side only sends text and metadata.
 */
export class HttpCorpusStore implements CorpusStore, VersionedCorpusStore {
  readonly backend = "pgvector";
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.endpoint = baseUrl.replace(/\/+$/, "");
    this.fetcher = fetcher;
  }

  /** Non-zero means the optional corpus connector is configured and can be attempted. */
  size(): number {
    return this.endpoint ? 1 : 0;
  }

  private async call<T>(
    path: string,
    init?: { method?: string; body?: unknown; timeoutMs?: number },
  ): Promise<T> {
    const response = await this.fetcher(`${this.endpoint}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", accept: "application/json" },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      throw new Error("retrieval_http_404");
    }
    const payload = await response.json().catch(() => null) as
      | (T & { errors?: { code?: string; message?: string }[] })
      | null;
    if (!response.ok || !payload) {
      const e = payload?.errors?.[0];
      throw new Error(e?.message ?? e?.code ?? `retrieval_http_${response.status}`);
    }
    return payload;
  }

  async search(queries: string[], limit: number): Promise<SourceRecord[]> {
    const query = queries.map((item) => item.trim()).filter(Boolean).join(" ");
    if (!query) return [];
    const response = await this.fetcher(`${this.endpoint}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, k: Math.min(10, Math.max(1, limit)) }),
    });
    if (!response.ok) throw new Error(`retrieval_http_${response.status}`);
    const payload = await response.json() as RetrievalResult;
    if (!Array.isArray(payload.results)) {
      throw new Error(payload.errors?.[0]?.code ?? "retrieval_invalid_response");
    }
    return payload.results.flatMap((item): SourceRecord[] => {
      if (!item.chunk_id || !item.document_id || !item.url || !item.quoted_text) return [];
      return [{
        source_id: `corpus:${item.chunk_id}`,
        route: "corpus",
        title: item.title ?? item.url,
        publisher: item.publisher ?? new URL(item.url).hostname,
        url: item.url,
        published_at: item.published_at ?? null,
        retrieved_at: item.retrieved_at ?? new Date().toISOString(),
        tier: "official",
        origin_key: `corpus:${item.document_id}:${item.document_version ?? 1}`,
        text: item.quoted_text,
      }];
    });
  }

  /** Ingest goes through replace() (POST /documents); this legacy entry point is a no-op. */
  async upsert(_records: SourceRecord[]): Promise<void> {}

  // ── VersionedCorpusStore ───────────────────────────────────────────────────

  async revision(): Promise<number> {
    return (await this.call<{ corpus_revision: number }>("/revision", { timeoutMs: 5_000 })).corpus_revision;
  }

  async replace(docs: DocumentInput[]): Promise<ReplaceResult> {
    if (!docs.length) return { results: [], corpus_revision: await this.revision() };
    // Embedding many documents on CPU takes a while on the first call (model load).
    return await this.call<ReplaceResult>("/documents", {
      method: "POST",
      body: { documents: docs },
      timeoutMs: 300_000,
    });
  }

  async query(q: CorpusQuery): Promise<{ hits: CorpusHit[]; corpus_revision: number }> {
    if (!q.query.trim() || !q.publisher_ids.length || !q.binding_ids.length) {
      return { hits: [], corpus_revision: await this.revision() };
    }
    const payload = await this.call<RetrievalResult>("/search", {
      method: "POST",
      body: {
        query: q.query.slice(0, 1000),
        k: Math.min(20, Math.max(1, q.k)),
        filters: {},
        publisher_ids: q.publisher_ids,
        binding_ids: q.binding_ids,
        mode: q.mode,
        today: q.today,
        ...(q.claim_period ? { claim_period: q.claim_period } : {}),
        freshness: q.freshness,
      },
    });
    if (!Array.isArray(payload.results)) {
      throw new Error(payload.errors?.[0]?.code ?? "retrieval_invalid_response");
    }
    const hits = payload.results.flatMap((r): CorpusHit[] => {
      if (!r.chunk_id || !r.document_id || !r.url || !r.quoted_text || !r.publisher_id || !r.binding_id) {
        return [];
      }
      return [{
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        version: r.document_version ?? 1,
        publisher_id: r.publisher_id,
        binding_id: r.binding_id,
        kind: r.kind ?? "dated_statement",
        status: r.status ?? "current",
        title: r.title ?? r.url,
        url: r.url,
        published_at: r.published_at ?? null,
        retrieved_at: r.retrieved_at ?? new Date().toISOString(),
        effective_from: r.effective_from ?? null,
        effective_to: r.effective_to ?? null,
        quoted_text: r.quoted_text,
        score: r.score ?? 0,
        stale: Boolean(r.stale),
      }];
    });
    return { hits, corpus_revision: payload.corpus_revision ?? -1 };
  }

  async list(f: CorpusListFilter): Promise<{ documents: DocumentVersion[]; corpus_revision: number }> {
    const p = new URLSearchParams();
    if (f.publisher_id) p.set("publisher_id", f.publisher_id);
    if (f.binding_id) p.set("binding_id", f.binding_id);
    if (f.q) p.set("q", f.q);
    if (f.date) p.set("date", f.date);
    if (f.include_superseded) p.set("include_superseded", "1");
    if (f.limit) p.set("limit", String(f.limit));
    return await this.call(`/documents?${p}`);
  }

  async history(documentId: string): Promise<DocumentVersion[] | null> {
    try {
      return (await this.call<{ versions: DocumentVersion[] }>(
        `/documents/${encodeURIComponent(documentId)}/versions`,
      )).versions;
    } catch (err) {
      if ((err as Error).message === "retrieval_http_404") return null;
      throw err;
    }
  }
}
