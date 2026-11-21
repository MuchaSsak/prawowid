/**
 * Evidence access: the one service the verifier and the operator panel share. It turns a registry
 * revision into the pipeline's Connector[] (builtin live adapters, JSON-template live adapters and one
 * corpus route over every active corpus binding), passes every returned record through the eligibility
 * rule and rewrites tier, publisher and origin from the registry. It also revalidates a finished
 * result against the active revision, runs operator probes and draft samples, and accepts uploads.
 */
import type { Config } from "../config.ts";
import { eurostat } from "../connectors/eurostat.ts";
import { googleFactCheck } from "../connectors/google-factcheck.ts";
import { gus } from "../connectors/gus.ts";
import { nbp } from "../connectors/nbp.ts";
import { sejmEli } from "../connectors/sejm-eli.ts";
import {
  type ClaimQuery,
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type SourceRecord,
} from "../connectors/types.ts";
import { retrieve } from "../pipeline/retrieve.ts";
import type { TrustedSource } from "../sources/catalog.ts";
import type { CorpusStore } from "../store/types.ts";
import type { ClaimResult, ClaimType, RouteOutcome } from "../types.ts";
import {
  type AdapterItem,
  ADAPTERS,
  type FetchDeps,
  fetchFeed,
  fetchTemplate,
  JSON_TEMPLATES,
} from "./adapters.ts";
import {
  claimWindow,
  contentHash,
  type CorpusHit,
  type DocumentInput,
  type VersionedCorpusStore,
} from "./corpus.ts";
import { bindingUsable, checkEligibility, eligiblePublishers, type IneligibleReason } from "./eligibility.ts";
import type { RegistryStore } from "./store.ts";
import {
  type AggregatorLink,
  type Binding,
  type Capability,
  type Draft,
  type DraftChange,
  type Publisher,
  type Registry,
  type RegistryContent,
  RegistryValidationError,
} from "./types.ts";
import { validateRegistry } from "./validate.ts";

export const BUILTINS: Record<string, Connector> = Object.fromEntries(
  [googleFactCheck, sejmEli, eurostat, nbp, gus].map((c) => [c.id, c]),
);

/** Route detail prefix for a capability whose only binding is disabled (not a failure, not "no hits"). */
export const UNSUPPORTED_SCOPE = "nieobsługiwany zakres";

export const REGISTRY_UNAVAILABLE_PL =
  "Lista zatwierdzonych źródeł jest chwilowo niedostępna. Spróbuj ponownie za chwilę.";
export const SOURCE_DISABLED_PL = (publisher: string) =>
  `Źródło użyte w tej ocenie (${publisher}) zostało wyłączone w trakcie sprawdzania. Spróbuj ponownie. To nie jest ocena treści.`;
export const RECHECK_FAILED_PL =
  "Nie udało się potwierdzić, że użyte źródła są nadal zatwierdzone. Spróbuj ponownie. To nie jest ocena treści.";

export interface DroppedRecord {
  route: string;
  title: string;
  url: string;
  reason: IneligibleReason;
  message: string;
}

export interface AccessOptions {
  config: Config;
  now?: () => Date;
  /** Constrained-fetch dependencies for RSS / JSON-template adapters (fetcher, DNS, robots). */
  fetch?: FetchDeps;
}

/** Fields a probe or sample shows per record. */
export interface InspectedRecord {
  route: string;
  title: string;
  url: string;
  publisher: string;
  published_at: string | null;
  tier: string | null;
  excerpt: string;
  eligible: boolean;
  reason: string | null;
}

function rewrite(r: SourceRecord, p: Publisher, b: Binding): SourceRecord {
  // Tier and origin come from the publisher: one publisher counts once across routes and versions.
  return { ...r, route: b.id, publisher: p.name, tier: p.tier, origin_key: `publisher:${p.id}` };
}

/** Upsert a draft's publisher, binding and links into registry content. */
export function applyDraft(next: RegistryContent, change: DraftChange): void {
  const upsert = <T>(list: T[], item: T, same: (x: T) => boolean) => {
    const i = list.findIndex(same);
    if (i >= 0) list[i] = item;
    else list.push(item);
  };
  if (change.publisher) upsert(next.publishers, change.publisher, (x) => x.id === change.publisher!.id);
  if (change.binding) upsert(next.bindings, change.binding, (x) => x.id === change.binding!.id);
  for (const l of change.links ?? []) {
    upsert(
      next.links,
      l,
      (x: AggregatorLink) => x.binding_id === l.binding_id && x.publisher_id === l.publisher_id,
    );
  }
}

function excerpt(t: string, n = 240) {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export class EvidenceAccess {
  constructor(
    readonly store: RegistryStore,
    readonly corpus: VersionedCorpusStore,
    private readonly opts: AccessOptions,
  ) {}

  get config(): Config {
    return this.opts.config;
  }

  today(): string {
    return (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10);
  }

  async corpusRevision(): Promise<number> {
    try {
      return await this.corpus.revision();
    } catch {
      return -1;
    }
  }

  /** The pipeline's routes for one registry revision, plus coverage stubs for disabled-only capabilities. */
  connectors(reg: Registry, onDrop?: (d: DroppedRecord) => void): Connector[] {
    const out: Connector[] = [];
    const filter = (b: Binding, records: SourceRecord[]): SourceRecord[] =>
      records.flatMap((r) => {
        const e = checkEligibility(reg, b.id, r.url);
        if (e.ok) return [rewrite(r, e.publisher, b)];
        onDrop?.({ route: b.id, title: r.title, url: r.url, reason: e.reason, message: e.message });
        return [];
      });

    const usable = reg.bindings.filter((b) => bindingUsable(reg, b));
    for (const b of usable) {
      if (b.adapter === "builtin") {
        const inner = BUILTINS[String(b.config.connector)];
        if (!inner) continue;
        // The aggregator's own publisher filter reads config.trustedSources: give it the registry's view.
        const trusted: TrustedSource[] = eligiblePublishers(reg, b).map((p) => ({
          id: p.id,
          name: p.name,
          domains: p.scopes.map((s) => s.host),
          kind: p.kind,
          tier: p.tier,
          country: p.country,
          credentials: p.credentials,
          access: b.aggregator ? "google_factcheck" : "live_api",
          access_note: b.label,
          terms: p.terms,
        }));
        const scoped = (ctx: ConnectorContext): ConnectorContext => ({
          ...ctx,
          config: { ...ctx.config, trustedSources: trusted },
        });
        out.push({
          id: b.id,
          label: b.label,
          required: b.required,
          appliesTo: (c) => inner.appliesTo(c),
          unavailableReason: (ctx) => inner.unavailableReason(scoped(ctx)),
          search: async (c, ctx) => filter(b, await inner.search(c, scoped(ctx))),
        });
      } else if (b.adapter === "json_template") {
        out.push({
          id: b.id,
          label: b.label,
          required: b.required,
          appliesTo: () => true,
          unavailableReason: () => null,
          search: async (c, ctx) => {
            const q = c.search_queries_pl[0] ?? c.text;
            const items = await fetchTemplate(b, q, { ...this.opts.fetch, signal: ctx.signal }).catch(
              (err) => {
                throw err instanceof ConnectorError
                  ? err
                  : new ConnectorError("error", (err as Error).message);
              },
            );
            const now = new Date().toISOString();
            return filter(b, items.map((it) => this.itemRecord(b, it, now)));
          },
        });
      }
    }

    const corpusBindings = usable.filter((b) => b.mode === "corpus");
    if (corpusBindings.length) out.push(this.corpusConnector(reg, corpusBindings, filter));

    // Coverage: a capability whose only bindings are disabled is unsupported scope (skipped + warning).
    const covered = new Set<Capability>(usable.flatMap((b) => b.capabilities));
    const stubbed = new Set<string>();
    for (const b of reg.bindings) {
      if (usable.includes(b)) continue;
      const gap = b.capabilities.filter((c) => !covered.has(c));
      if (!gap.length) continue;
      const id = b.mode === "corpus" ? "corpus" : b.id;
      if (stubbed.has(id) || out.some((c) => c.id === id)) continue;
      stubbed.add(id);
      const inner = b.adapter === "builtin" ? BUILTINS[String(b.config.connector)] : null;
      out.push(gapStub({
        id,
        label: b.mode === "corpus" ? "Korpus źródeł Prawdomatu" : b.label,
        required: false,
        appliesTo: (c) => (inner ? inner.appliesTo(c) : true),
        unavailableReason: () => `${UNSUPPORTED_SCOPE}: ${b.label} jest wyłączone i nic go nie zastępuje`,
        search: () => Promise.resolve([]),
      }));
    }
    return out;
  }

  private itemRecord(b: Binding, it: AdapterItem, retrieved: string): SourceRecord {
    return {
      source_id: `${b.id}:${it.url}`,
      route: b.id,
      title: it.title,
      publisher: "",
      url: it.url,
      published_at: it.published_at,
      retrieved_at: retrieved,
      tier: "other",
      origin_key: "",
      text: it.text.slice(0, 2000),
    };
  }

  private corpusConnector(
    reg: Registry,
    bindings: Binding[],
    filter: (b: Binding, r: SourceRecord[]) => SourceRecord[],
  ): Connector {
    const byId = new Map(bindings.map((b) => [b.id, b]));
    const publisherIds = [...new Set(bindings.flatMap((b) => eligiblePublishers(reg, b).map((p) => p.id)))];
    const freshness = bindings.filter((b) => b.freshness_days).map((b) => ({
      binding_id: b.id,
      days: b.freshness_days!,
    }));
    return {
      id: "corpus",
      label: "Korpus źródeł Prawdomatu",
      required: bindings.some((b) => b.required),
      appliesTo: () => true,
      unavailableReason: () => null,
      search: async (c) => {
        const today = this.today();
        const w = claimWindow(c.time, today);
        let res;
        try {
          res = await this.corpus.query({
            query: [c.text, ...c.search_queries_pl.filter((q) => q !== c.text)].join(" "),
            k: 12,
            publisher_ids: publisherIds,
            binding_ids: [...byId.keys()],
            mode: w.mode,
            today,
            claim_period: w.period,
            freshness,
          });
        } catch (err) {
          throw new ConnectorError("error", `korpus: ${(err as Error).message}`);
        }
        const fresh = res.hits.filter((h) => !h.stale);
        const records = this.hitRecords(fresh, reg).flatMap((r) => filter(byId.get(r.route)!, [r]));
        if (!records.length) {
          const stale = res.hits.find((h) => h.stale && byId.get(h.binding_id)?.required);
          if (stale) {
            throw new ConnectorError(
              "unavailable",
              `wymagane dane są nieaktualne: „${stale.title}” (aktualizacja ${
                (stale.published_at ?? stale.retrieved_at).slice(0, 10)
              })`,
            );
          }
        }
        return records.slice(0, 5);
      },
    };
  }

  /** One record per document version: its best chunks, in text order. */
  private hitRecords(hits: CorpusHit[], reg: Registry): SourceRecord[] {
    const groups = new Map<string, CorpusHit[]>();
    for (const h of hits) {
      groups.set(`${h.document_id}@${h.version}`, [
        ...(groups.get(`${h.document_id}@${h.version}`) ?? []),
        h,
      ]);
    }
    return [...groups.entries()].map(([key, hs]) => {
      const h = hs[0];
      const chunks = hs.slice(0, 2).sort((a, b) =>
        a.chunk_id.localeCompare(b.chunk_id, undefined, { numeric: true })
      );
      const stand = h.kind === "standing_state"
        ? `[Stan na ${(h.published_at ?? h.retrieved_at).slice(0, 10)}${
          h.effective_to ? `, obowiązuje do ${h.effective_to}` : ""
        }]\n`
        : "";
      return {
        source_id: `doc:${key}`,
        route: h.binding_id,
        title: h.title,
        publisher: reg.publishers.find((p) => p.id === h.publisher_id)?.name ?? "",
        url: h.url,
        published_at: h.published_at,
        retrieved_at: h.retrieved_at,
        tier: "other",
        origin_key: "",
        text: stand + chunks.map((x) => x.quoted_text).join("\n"),
      };
    });
  }

  /** CorpusStore view for the pipeline's date lookup (dates.ts): same filters as the evidence route. */
  corpusView(): CorpusStore {
    return {
      size: () => 1,
      upsert: () => Promise.resolve(),
      search: async (queries, limit) => {
        try {
          const reg = await this.store.read();
          const bindings = reg.bindings.filter((b) => b.mode === "corpus" && bindingUsable(reg, b));
          if (!bindings.length) return [];
          const c = this.corpusConnector(reg, bindings, (b, rs) =>
            rs.flatMap((r) => {
              const e = checkEligibility(reg, b.id, r.url);
              return e.ok ? [rewrite(r, e.publisher, b)] : [];
            }));
          const q = queries.join(" ");
          return (await c.search(probeClaim(q), null as unknown as ConnectorContext)).slice(0, limit);
        } catch {
          return [];
        }
      },
    };
  }

  /** Re-read the active revision and re-check every cited record. Affected claims become retryable states. */
  async revalidate(claims: ClaimResult[]): Promise<{ claims: ClaimResult[]; affected: number }> {
    let reg: Registry | null = null;
    try {
      reg = await this.store.read();
    } catch {
      reg = null;
    }
    let affected = 0;
    const out = claims.map((c) => {
      if (!c.citations.length) return c;
      let message: string | null = null;
      if (!reg) message = RECHECK_FAILED_PL;
      else {
        const bad = c.citations.find((x) => !checkEligibility(reg!, x.route, x.url).ok);
        if (bad) message = SOURCE_DISABLED_PL(bad.publisher);
      }
      if (!message) return c;
      affected++;
      return {
        ...c,
        verdict: null,
        verdict_label: null,
        system_state: "source_unavailable" as const,
        system_message: message,
        strength: null,
        explanation: "",
        missing: null,
        citations: [],
      };
    });
    return { claims: out, affected };
  }

  /** Operator probe: active routes and corpus for a claim, without the LLM, with dropped records and why. */
  async probe(
    input: {
      text: string;
      type?: ClaimType | null;
      time?: string;
      indicator?: string | null;
      geo?: string | null;
      currency?: string | null;
    },
  ) {
    const reg = await this.store.read();
    const dropped: DroppedRecord[] = [];
    const claim = {
      ...probeClaim(input.text),
      type: input.type ?? null,
      time: input.time || "unknown",
      indicator: input.indicator ?? null,
      geo: input.geo ?? null,
      currency: input.currency ?? null,
    };
    const r = await retrieve(claim, this.connectors(reg, (d) => dropped.push(d)), {
      config: this.config,
      signal: AbortSignal.timeout(20_000),
      corpus: this.corpusView(),
    });
    return {
      revision: reg.revision,
      corpus_revision: await this.corpusRevision(),
      routes: r.routes,
      records: r.records.map((x): InspectedRecord => ({
        route: x.route,
        title: x.title,
        url: x.url,
        publisher: x.publisher,
        published_at: x.published_at,
        tier: x.tier,
        excerpt: excerpt(x.text, 400),
        eligible: true,
        reason: null,
      })),
      dropped: dropped.map((d): InspectedRecord => ({
        route: d.route,
        title: d.title,
        url: d.url,
        publisher: "",
        published_at: null,
        tier: null,
        excerpt: "",
        eligible: false,
        reason: d.message,
      })),
    };
  }

  /** Run a draft's adapter against the real source, without storing anything. */
  async sampleDraft(
    draft: Draft,
    query: string,
  ): Promise<{ ok: boolean; errors: string[]; note: string | null; records: InspectedRecord[] }> {
    const current = await this.store.read();
    const merged = structuredClone({
      publishers: current.publishers,
      bindings: current.bindings,
      links: current.links,
    });
    applyDraft(merged, draft.change);
    const errors = validateRegistry(merged);
    const b = draft.change.binding;
    if (!b) errors.push("szkic nie ma powiązania do przetestowania");
    if (errors.length) return { ok: false, errors, note: null, records: [] };
    // For the sample the draft's own publisher, binding and links count as active.
    const reg: Registry = {
      ...merged,
      revision: current.revision,
      published_at: current.published_at,
      published_by: current.published_by,
      publishers: merged.publishers.map((
        p,
      ) => (p.id === draft.change.publisher?.id ? { ...p, active: true } : p)),
      bindings: merged.bindings.map((x) => (x.id === b!.id ? { ...x, active: true } : x)),
    };
    let items: AdapterItem[] = [];
    try {
      if (b!.adapter === "rss") {
        items = await fetchFeed(b!, this.opts.fetch);
        if (query.trim()) {
          const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const hit = items.filter((i) =>
            words.some((w) => `${i.title} ${i.text}`.toLowerCase().includes(w))
          );
          if (hit.length) items = hit;
        }
      } else if (b!.adapter === "json_template") {
        items = await fetchTemplate(b!, query.trim() || "a", this.opts.fetch, 10);
      } else if (b!.adapter === "upload") {
        return {
          ok: true,
          errors: [],
          note: "Dokumenty dodasz po aktywacji. Każdy musi mieć publiczny adres u wydawcy.",
          records: [],
        };
      } else {
        return { ok: false, errors: ["wbudowane konektory dodaje się w kodzie"], note: null, records: [] };
      }
    } catch (err) {
      return {
        ok: false,
        errors: [`pobranie nie powiodło się: ${(err as Error).message}`],
        note: null,
        records: [],
      };
    }
    const publisher = reg.publishers.find((p) => p.id === b!.publisher_id);
    const records = items.slice(0, 15).map((it): InspectedRecord => {
      const e = checkEligibility(reg, b!.id, it.url);
      return {
        route: b!.id,
        title: it.title,
        url: it.url,
        publisher: publisher?.name ?? "",
        published_at: it.published_at,
        tier: publisher?.tier ?? null,
        excerpt: excerpt(it.text),
        eligible: e.ok,
        reason: e.ok ? null : e.message,
      };
    });
    return {
      ok: true,
      errors: [],
      note: records.length ? null : "Źródło odpowiedziało, ale nie zwróciło wpisów.",
      records,
    };
  }

  /** Activate a draft as one new revision. Network adapters need a successful sample first. */
  async activateDraft(draft: Draft, operator: string): Promise<Registry> {
    const b = draft.change.binding;
    if (b && (b.adapter === "rss" || b.adapter === "json_template") && !draft.sample?.ok) {
      throw new RegistryValidationError(["najpierw przetestuj źródło (Testuj)"]);
    }
    const reg = await this.store.publish(
      operator,
      "activate",
      `aktywacja szkicu: ${[draft.change.publisher?.id, b?.id].filter(Boolean).join(" + ")}`,
      (next) => applyDraft(next, draft.change),
    );
    await this.store.deleteDraft(draft.id);
    return reg;
  }

  /**
   * Upload or replace one document on a corpus binding. Requires a public canonical publisher URL in
   * the publisher's scope. The eligibility re-check and the commit run under the registry lock.
   */
  async upload(bindingId: string, input: {
    document_id?: string;
    title: string;
    canonical_url: string;
    text: string;
    published_at?: string | null;
    effective_from?: string | null;
    effective_to?: string | null;
    kind?: "dated_statement" | "standing_state";
  }, operator: string) {
    if (!input.title?.trim() || !input.text?.trim()) {
      throw new RegistryValidationError(["tytuł i treść są wymagane"]);
    }
    const docId = input.document_id?.trim() ||
      `${bindingId}:${(await contentHash(input.canonical_url)).slice(0, 16)}`;
    const existing = await this.corpus.history(docId);
    const result = await this.store.exclusive(async (reg) => {
      const b = reg.bindings.find((x) => x.id === bindingId);
      if (!b || b.adapter !== "upload") {
        throw new RegistryValidationError(["to powiązanie nie przyjmuje dokumentów"]);
      }
      if (!/^https:\/\//.test(input.canonical_url)) {
        throw new RegistryValidationError(["potrzebny publiczny adres https:// u wydawcy"]);
      }
      const e = checkEligibility(reg, b.id, input.canonical_url);
      if (!e.ok) throw new RegistryValidationError([`adres nie przechodzi: ${e.message}`]);
      if (existing?.length && existing[0].binding_id && existing[0].binding_id !== b.id) {
        throw new RegistryValidationError([
          `dokument ${docId} należy do powiązania ${existing[0].binding_id}`,
        ]);
      }
      const doc: DocumentInput = {
        document_id: docId,
        publisher_id: e.publisher.id,
        binding_id: b.id,
        kind: input.kind ?? b.doc_kind,
        title: input.title.trim(),
        canonical_url: input.canonical_url.trim(),
        published_at: input.published_at || null,
        retrieved_at: new Date().toISOString(),
        effective_from: input.effective_from || null,
        effective_to: input.effective_to || null,
        text: input.text.trim(),
        language: "pl",
        license_status: "operator_upload",
        test_data: Boolean(e.publisher.test_data),
      };
      return await this.corpus.replace([doc]);
    });
    const r = result.results[0];
    await this.store.note(operator, "upload", `${docId} → wersja ${r.version} (${r.status})`);
    return { ...r, document_id: docId, corpus_revision: result.corpus_revision };
  }

  /** Public view for GET /api/v1/sources: active evidence publishers and how they are reached. */
  publicSources(reg: Registry) {
    const usable = reg.bindings.filter((b) => bindingUsable(reg, b));
    return reg.publishers.filter((p) => p.active && p.role === "evidence").map((p) => {
      const via = usable.filter((b) => eligiblePublishers(reg, b).some((x) => x.id === p.id));
      const access = via.some((b) => b.aggregator)
        ? "google_factcheck"
        : via.some((b) => b.mode === "live")
        ? "live_api"
        : via.length
        ? "corpus"
        : "not_connected";
      return {
        id: p.id,
        name: p.name,
        domains: p.scopes.map((s) => `${s.host}${s.path_prefix ?? ""}`),
        kind: p.kind,
        tier: p.tier,
        country: p.country,
        credentials: p.credentials,
        access,
        access_note: via.map((b) => b.label).join(", ") || "brak aktywnego dostępu",
        terms: p.terms,
        ...(p.test_data ? { test_data: true } : {}),
      };
    });
  }

  adapters() {
    return {
      adapters: ADAPTERS,
      templates: Object.values(JSON_TEMPLATES).map(({ id, label, description }) => ({
        id,
        label,
        description,
      })),
    };
  }
}

const GAPS = new WeakSet<Connector>();
function gapStub(c: Connector): Connector {
  GAPS.add(c);
  return c;
}
/** True for the placeholder route of a capability whose only source is disabled (not an active route). */
export function isCoverageGap(c: Connector): boolean {
  return GAPS.has(c);
}

export function probeClaim(text: string): ClaimQuery {
  return {
    text,
    type: null,
    time: "unknown",
    entities: [],
    search_queries_pl: [text],
    search_query_en: "",
    indicator: null,
    geo: null,
    claimed_value: null,
    currency: null,
  };
}

export type { RouteOutcome };
