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
  /** Official statistic the claim is about (connectors/stats-catalog.ts), else null. */
  indicator: string | null;
  /** ISO 3166 alpha-2 country code, or "EU"; null when not about a country. */
  geo: string | null;
  /** The number the claim states, in the indicator unit. */
  claimed_value: number | null;
  /** ISO 4217 code for exchange-rate claims. */
  currency: string | null;
}

/** Machine-readable values behind an official data record, for the code-side number check. */
export interface RecordData {
  indicator: string;
  unit: string;
  kind: "percent" | "number";
  /** Compare absolute values (e.g. deficit stated as a positive number). */
  compare_abs?: boolean;
  points: { period: string; value: number }[];
  /** Periods the claim refers to; empty when the record cannot tell (no number check then). */
  target_periods: string[];
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
  /** Official data records only: the values, so code can check the claimed number. */
  data?: RecordData;
  /** Literal offsets in the underlying stored text, when a chunk is indexed. */
  start_offset?: number;
  end_offset?: number;
}

export class ConnectorError extends Error {
  constructor(public kind: "unavailable" | "timeout" | "rate_limited" | "invalid_response" | "not_found" | "error", message: string) {
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

/** One retry for transient failures (network error, 5xx, 429), as the pipeline allows (§3). */
export async function fetchJson(url: string, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  try {
    return await fetchJsonOnce(url, signal, timeoutMs);
  } catch (err) {
    const transient = err instanceof ConnectorError && (err.kind === "error" || err.kind === "rate_limited");
    if (!transient || signal.aborted) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return await fetchJsonOnce(url, signal, timeoutMs);
  }
}

/** Plain text fetch (XML files), same timeout and error mapping, one retry on transient errors. */
export async function fetchText(url: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  const once = async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ConnectorError("timeout", "timeout");
      }
      throw new ConnectorError("error", (err as Error).message);
    }
    if (res.status === 429) throw new ConnectorError("rate_limited", "HTTP 429");
    if (!res.ok) throw new ConnectorError("error", `HTTP ${res.status}`);
    return await res.text();
  };
  try {
    return await once();
  } catch (err) {
    const transient = err instanceof ConnectorError && (err.kind === "error" || err.kind === "rate_limited");
    if (!transient || signal.aborted) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return await once();
  }
}

async function fetchJsonOnce(url: string, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
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
  if (res.status === 404) {
    await res.body?.cancel();
    throw new ConnectorError("not_found", "HTTP 404");
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
