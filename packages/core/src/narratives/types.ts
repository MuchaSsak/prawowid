/**
 * Known-incident matching: "has this narrative already appeared in documented disinformation?"
 *
 * Deliberately separate from connectors/ (evidence): a matcher's output is never a SourceRecord, never
 * reaches the assessment model and never decides a verdict. It only adds `context_matches` and a
 * `known_narrative` warning to a claim (hard constraints; wiki architecture/euvsdisinfo-mcp.md).
 *
 * Two matchers share this interface:
 *   euvsdisinfo_live    the MCP `search` tool at check time (keyword, mostly English). Works today.
 *   euvsdisinfo_corpus  our own index of every case (KnownIncidentStore): hybrid FTS + embeddings
 *                       once Supabase is in; takes over automatically when the store is filled.
 */
import type { Config } from "../config.ts";
import type { ClaimQuery } from "../connectors/types.ts";
import type { ContextMatch } from "../types.ts";

/** One catalog record in our normalized shape: what the ingest writes and the corpus store holds. */
export interface KnownIncident {
  /** Stable id, e.g. "euvsdisinfo:case:<uuid>". */
  id: string;
  catalog: "EUvsDisinfo";
  record_type: "case" | "article";
  title: string;
  /** Cases: the disinformation claim, verbatim. Articles: the opening of the text. */
  claim: string;
  /** Cases: EUvsDisinfo's debunk. Empty for articles. */
  fact: string;
  url: string;
  published_at: string | null;
  keywords: string[];
  countries: string[];
  /** Languages of the disinformation outlets (cases) or of the article. */
  languages: string[];
  /** Hosts of the outlets that spread it (cases), for URL / domain matching of submitted links. */
  outlet_hosts: string[];
  retrieved_at: string;
}

export interface IncidentQuery {
  claim: ClaimQuery;
  /** Filled by the caller once embeddings exist (same model as the index). */
  embedding?: number[];
}

export interface ScoredIncident {
  incident: KnownIncident;
  score: number;
  match: ContextMatch["match"];
}

/** Our index of known incidents. Memory today (tests, small snapshots); Supabase later (decision 001: corpus schema). */
export interface KnownIncidentStore {
  size(): number;
  search(query: IncidentQuery, limit: number): Promise<ScoredIncident[]>;
  upsert(incidents: KnownIncident[]): Promise<void>;
}

export interface NarrativeContext {
  config: Config;
  signal: AbortSignal;
  incidents?: KnownIncidentStore;
}

export interface NarrativeMatcher {
  id: string;
  /** Matchers of one catalog are alternatives: the first available one in NARRATIVE_MATCHERS runs. */
  catalog: string;
  label: string;
  /** A reason when it cannot run here (no key, empty index). */
  unavailableReason(ctx: NarrativeContext): string | null;
  match(claim: ClaimQuery, ctx: NarrativeContext): Promise<ContextMatch[]>;
}
