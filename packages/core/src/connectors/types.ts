import type { Config } from "../config.ts";
import type { ClaimType, SourceTier } from "../types.ts";
import type { CorpusStore } from "../store/types.ts";

/** What a connector needs to know about a claim. */
export interface ClaimQuery {
  text: string;
  type: ClaimType | null;
  time: string;
  entities: string[];
  search_queries_pl: string[];
  search_query_en: string;
}

/** A stored, citable source record. The model never writes any of these fields (hard constraint 2). */
export interface SourceRecord {
  source_id: string;
  route: string;
  title: string;
  publisher: string;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  tier: SourceTier;
  /** Same underlying origin counts once (syndication, mirrors). */
  origin_key: string;
  /** The passage the assessment model reads and quotes from. */
  text: string;
}

export class ConnectorError extends Error {
  constructor(public kind: "unavailable" | "timeout" | "rate_limited" | "invalid_response" | "error", message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

export interface ConnectorContext {
  config: Config;
  signal: AbortSignal;
  corpus: CorpusStore;
}

export interface Connector {
  id: string;
  label: string;
  /** A required route that fails makes the claim a system state, never "insufficient evidence". */
  required: boolean;
  appliesTo(claim: ClaimQuery): boolean;
  /** Returns a reason when the route cannot run in this deployment (missing key, empty corpus). */
  unavailableReason(ctx: ConnectorContext): string | null;
  search(claim: ClaimQuery, ctx: ConnectorContext): Promise<SourceRecord[]>;
}

export async function fetchJson(url: string, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ConnectorError("timeout", "timeout");
    }
    throw new ConnectorError("error", (err as Error).message);
  }
  if (res.status === 429) throw new ConnectorError("rate_limited", "HTTP 429");
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new ConnectorError("unavailable", `HTTP ${res.status} (key rejected or API not enabled)`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ConnectorError("error", `HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new ConnectorError("invalid_response", "invalid JSON");
  }
}
