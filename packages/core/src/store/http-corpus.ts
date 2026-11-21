import type { SourceRecord } from "../connectors/types.ts";
import type { CorpusStore } from "./types.ts";

type RetrievalResult = {
  results?: Array<{
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
  }>;
  errors?: Array<{ code?: string; message?: string }>;
};

/** CorpusStore adapter for the standalone Python + pgvector retrieval service. */
export class HttpCorpusStore implements CorpusStore {
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

  /** Ingest remains owned by scripts/ingest_corpus.py for this adapter. */
  async upsert(_records: SourceRecord[]): Promise<void> {}
}
