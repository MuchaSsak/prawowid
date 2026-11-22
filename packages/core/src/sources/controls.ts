/**
 * Source controls: an operator switches evidence sources off and on without a deploy (admin page
 * /admin/zrodla). Three kinds of switch, one key each:
 *   route:<connector id>        a live evidence route (Google Fact Check, Sejm ELI, ..., the corpus)
 *   corpus:<collection id>      one collection inside our own corpus (Demagog, CERT Polska, IMGW, ...)
 *   publisher:<catalog id>      a publisher on the trusted-source allowlist, on every route
 * A switched-off source never becomes evidence. A switched-off required route turns its claims into
 * the "source unavailable" system state (hard constraint 8), never into a verdict. The caller reads
 * the state once at check start and passes the result into runCheck, so a change made mid-check
 * never mixes two states in one answer.
 */
import type { Connector, SourceRecord } from "../connectors/types.ts";
import type { CorpusStore } from "../store/types.ts";
import { type TrustedSource, trustedSourceFor } from "./catalog.ts";

export type SourceControlKind = "route" | "corpus" | "publisher";

export interface SourceControlAudit {
  at: string;
  key: string;
  enabled: boolean;
}

export interface SourceControlState {
  /** Bumped on every change; part of the result cache key, so a change is never hidden by a cached answer. */
  revision: number;
  updated_at: string | null;
  /** Keys of switched-off sources. Everything else is on. */
  disabled: string[];
  /** Newest first. */
  audit: SourceControlAudit[];
}

export const EMPTY_SOURCE_CONTROLS: SourceControlState = { revision: 0, updated_at: null, disabled: [], audit: [] };
export const SOURCE_CONTROL_AUDIT_MAX = 50;
/** Route detail shown when an operator switched the route off. */
export const SOURCE_DISABLED_DETAIL = "wyłączone przez administratora";

export const sourceKey = (kind: SourceControlKind, id: string) => `${kind}:${id}`;

/** Collection id of a corpus record (`corpus:<collection>:...`), or null for live-route records. */
export function collectionOf(record: SourceRecord): string | null {
  const m = /^corpus:([^:]+):/.exec(record.source_id);
  return m ? m[1] : null;
}

/** Corpus collection summary, as IndexedCorpusStore.collections() returns it. */
export interface CollectionInfo {
  id: string;
  label: string;
  records: number;
  latest: string | null;
}

export interface SourceListItem {
  key: string;
  kind: SourceControlKind;
  id: string;
  label: string;
  enabled: boolean;
  required?: boolean;
  records?: number;
  latest?: string | null;
  tier?: string;
  access?: string;
}

/** Every switchable source, in display order: routes, corpus collections, publishers. */
export function listSources(
  input: { connectors: Connector[]; collections: CollectionInfo[]; trustedSources: TrustedSource[] },
  disabled: Iterable<string>,
): SourceListItem[] {
  const off = new Set(disabled);
  return [
    ...input.connectors.map((c) => ({
      key: sourceKey("route", c.id),
      kind: "route" as const,
      id: c.id,
      label: c.label,
      required: c.required,
      enabled: !off.has(sourceKey("route", c.id)),
    })),
    ...input.collections.map((c) => ({
      key: sourceKey("corpus", c.id),
      kind: "corpus" as const,
      id: c.id,
      label: c.label,
      records: c.records,
      latest: c.latest,
      enabled: !off.has(sourceKey("corpus", c.id)),
    })),
    ...input.trustedSources.map((s) => ({
      key: sourceKey("publisher", s.id),
      kind: "publisher" as const,
      id: s.id,
      label: s.name,
      tier: s.tier,
      access: s.access,
      enabled: !off.has(sourceKey("publisher", s.id)),
    })),
  ];
}

/** A new state with one switch flipped (no-op when it already has that value). */
export function setSourceEnabled(
  state: SourceControlState,
  key: string,
  enabled: boolean,
  now: Date = new Date(),
): SourceControlState {
  const off = new Set(state.disabled);
  if (off.has(key) === !enabled) return state;
  if (enabled) off.delete(key);
  else off.add(key);
  const at = now.toISOString();
  return {
    revision: state.revision + 1,
    updated_at: at,
    disabled: [...off].sort(),
    audit: [{ at, key, enabled }, ...state.audit].slice(0, SOURCE_CONTROL_AUDIT_MAX),
  };
}

type ViewableCorpus = CorpusStore & { view?: (exclude: (r: SourceRecord) => boolean) => CorpusStore };

export interface ControlledSources {
  connectors: Connector[];
  corpus: CorpusStore;
  trustedSources: TrustedSource[];
  /** Keep a record as evidence (false = it comes from a switched-off collection or publisher). */
  allows: (record: SourceRecord) => boolean;
}

/**
 * The evidence routes, corpus and allowlist with the switched-off sources removed. Pure: the same
 * state always gives the same result, so tests and the API share it.
 */
export function applySourceControls(
  base: { connectors: Connector[]; corpus: ViewableCorpus; trustedSources: TrustedSource[] },
  disabled: Iterable<string>,
): ControlledSources {
  const off = new Set(disabled);
  if (off.size === 0) return { ...base, allows: () => true };
  const offPublishers = base.trustedSources.filter((s) => off.has(sourceKey("publisher", s.id)));
  const allows = (record: SourceRecord): boolean => {
    const collection = collectionOf(record);
    if (collection && off.has(sourceKey("corpus", collection))) return false;
    return !offPublishers.length || trustedSourceFor(record.url, offPublishers) === null;
  };
  const corpus: CorpusStore = base.corpus.view ? base.corpus.view((r) => !allows(r)) : filteredCorpus(base.corpus, allows);
  const connectors = base.connectors.map((c): Connector => {
    if (off.has(sourceKey("route", c.id))) {
      return { ...c, unavailableReason: () => SOURCE_DISABLED_DETAIL, search: () => Promise.resolve([]) };
    }
    return { ...c, search: async (claim, ctx) => (await c.search(claim, ctx)).filter(allows) };
  });
  return {
    connectors,
    corpus,
    trustedSources: base.trustedSources.filter((s) => !off.has(sourceKey("publisher", s.id))),
    allows,
  };
}

/** Fallback for a corpus store without a cheap filtered view: over-fetch, then filter. */
function filteredCorpus(corpus: CorpusStore, allows: (r: SourceRecord) => boolean): CorpusStore {
  return {
    size: () => corpus.size(),
    upsert: (records) => corpus.upsert(records),
    search: async (queries, limit, options, signal) =>
      (await corpus.search(queries, limit * 4, options, signal)).filter(allows).slice(0, limit),
  };
}
