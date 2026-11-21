/**
 * Source registry types (prototype of architecture/source-platform.md).
 *
 * A publisher is who is cited (tier, evidence/context role, citation scopes). A binding is one access
 * path to evidence (adapter, mode, configuration, permitted request hosts, credential reference).
 * An aggregator binding (Google Fact Check) serves many publishers, each through an explicit link.
 * A record is eligible only when its publisher, binding and (for aggregators) link are all active and
 * its citation URL resolves to that publisher.
 */
import type { SourceKind } from "../sources/catalog.ts";
import type { SourceTier } from "../types.ts";

export type PublisherRole = "evidence" | "context";

/** A host (exact or subdomain) plus an optional path prefix (segment-aware). */
export interface CitationScope {
  host: string;
  path_prefix?: string;
}

export interface Publisher {
  id: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  role: PublisherRole;
  country: string;
  scopes: CitationScope[];
  credentials: string;
  terms: string;
  active: boolean;
  /** Fictional test publisher (prototype fixtures). Never shown as a real source. */
  test_data?: boolean;
}

export type AdapterType = "builtin" | "rss" | "upload" | "json_template";
export type BindingMode = "live" | "corpus";
/** What a binding can answer; used to report unsupported scope when no active binding covers it. */
export type Capability = "fact_check" | "legal" | "statistics" | "exchange_rate" | "population" | "documents";
export type DocKind = "dated_statement" | "standing_state";

export interface Binding {
  id: string;
  label: string;
  /** null for an aggregator (publishers come through links). */
  publisher_id: string | null;
  aggregator: boolean;
  adapter: AdapterType;
  mode: BindingMode;
  config: Record<string, string | number | boolean>;
  /** Hosts this binding may send requests to. Anything else, including redirects, is refused. */
  allowed_hosts: string[];
  /** Name of the env var holding the credential, never the value. */
  credential_env: string | null;
  required: boolean;
  capabilities: Capability[];
  /** Corpus bindings: kind of the documents they add. */
  doc_kind: DocKind;
  /** Standing-state documents older than this (publisher update date) are stale. null = no rule. */
  freshness_days: number | null;
  active: boolean;
}

export interface AggregatorLink {
  binding_id: string;
  publisher_id: string;
  active: boolean;
}

export interface RegistryContent {
  publishers: Publisher[];
  bindings: Binding[];
  links: AggregatorLink[];
}

export interface Registry extends RegistryContent {
  revision: number;
  published_at: string;
  published_by: string;
}

/** A proposed source: a new or changed publisher, binding and links, activated as one revision. */
export interface DraftChange {
  publisher?: Publisher;
  binding?: Binding;
  links?: AggregatorLink[];
}

export interface DraftSample {
  at: string;
  query: string;
  ok: boolean;
  records: number;
  eligible: number;
  errors: string[];
}

export interface Draft {
  id: string;
  created_at: string;
  created_by: string;
  base_revision: number;
  change: DraftChange;
  sample: DraftSample | null;
}

export interface AuditEntry {
  at: string;
  operator: string;
  action: string;
  /** Registry revision after the action (unchanged for draft and sync actions). */
  revision: number;
  detail: string;
}

export interface RegistryState {
  registry: Registry;
  drafts: Draft[];
  audit: AuditEntry[];
}

export class RegistryUnavailableError extends Error {
  constructor(public reason: "missing" | "corrupt" | "unreadable", message: string) {
    super(message);
    this.name = "RegistryUnavailableError";
  }
}

export class RegistryValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join("; "));
    this.name = "RegistryValidationError";
  }
}
