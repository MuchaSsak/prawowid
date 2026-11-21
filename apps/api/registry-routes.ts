/**
 * Source registry admin routes (prototype of architecture/source-platform.md), all behind the admin
 * token. The operator name comes from the X-Operator header: prototype only. Real, authenticated
 * operator identities must exist before writes are enabled in production.
 *
 *   GET    /api/v1/admin/registry                         revision, publishers, bindings, links, drafts,
 *                                                         sync state, adapters + templates, audit tail, backends
 *   POST   /api/v1/admin/registry/drafts                  new draft {publisher?, binding?, links?}
 *   POST   /api/v1/admin/registry/drafts/:id/sample       {query} → sample records + per-record eligibility
 *   POST   /api/v1/admin/registry/drafts/:id/activate     publish the draft as a new revision
 *   DELETE /api/v1/admin/registry/drafts/:id
 *   POST   /api/v1/admin/publishers/:id/active            {active}
 *   POST   /api/v1/admin/bindings/:id/active              {active}
 *   POST   /api/v1/admin/links/:binding/:publisher/active {active}
 *   POST   /api/v1/admin/bindings/:id/sync                fetch an RSS binding now
 *   POST   /api/v1/admin/bindings/:id/documents           upload or replace a document version
 *   GET    /api/v1/admin/corpus                           ?publisher_id&binding_id&q&date&include_superseded&limit
 *   GET    /api/v1/admin/corpus/versions?document_id=…    version history with text
 *   POST   /api/v1/admin/evidence/probe                   {text, type?, time?, indicator?, geo?, currency?}
 */
import type { Context, Hono } from "hono";
import {
  ADAPTERS,
  type AggregatorLink,
  applyDraft,
  type Binding,
  type Draft,
  type EvidenceAccess,
  type Ingestor,
  type Publisher,
  RegistryUnavailableError,
  RegistryValidationError,
  validateRegistry,
} from "@prawdowid/core";

export interface RegistryRoutesDeps {
  access: EvidenceAccess;
  ingestor: Ingestor;
  adminDenied: (c: Context) => Promise<Response | null>;
}

/** Prototype operator identity from a header; sanitized, never trusted for authorization. */
export function operatorOf(c: Context): string {
  const raw = (c.req.header("x-operator") ?? "").normalize("NFC").replace(/[^\p{L}\p{N} ._@-]/gu, "").trim()
    .slice(0, 60);
  return raw || "operator";
}

/** Route parameter as a string ("" when the route has none). */
const param = (c: Context, name: string): string =>
  (c.req.param as (n: string) => string | undefined)(name) ?? "";
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const hostOf = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Fill a draft publisher from operator input with safe defaults. */
function draftPublisher(x: Record<string, unknown>): Publisher {
  const scopes = Array.isArray(x.scopes) ? x.scopes : [];
  return {
    id: str(x.id, 63).toLowerCase(),
    name: str(x.name, 200),
    kind:
      (["official", "fact_checker", "news_agency", "public_media"].includes(String(x.kind))
        ? x.kind
        : "official") as Publisher["kind"],
    tier:
      (["official", "factcheck", "media", "other"].includes(String(x.tier))
        ? x.tier
        : "official") as Publisher["tier"],
    role: x.role === "context" ? "context" : "evidence",
    country: str(x.country, 8) || "PL",
    scopes: scopes.slice(0, 20).map((s: Record<string, unknown>) => ({
      host: str(s?.host, 253).toLowerCase(),
      ...(str(s?.path_prefix, 200) ? { path_prefix: str(s?.path_prefix, 200) } : {}),
    })),
    credentials: str(x.credentials),
    terms: str(x.terms),
    active: true,
    ...(x.test_data === true ? { test_data: true } : {}),
  };
}

function draftBinding(x: Record<string, unknown>): Binding {
  const adapter = String(x.adapter) as Binding["adapter"];
  const spec = ADAPTERS.find((a) => a.type === adapter);
  const config: Binding["config"] = {};
  for (const f of spec?.fields ?? []) {
    const v = (x.config as Record<string, unknown> | undefined)?.[f.name];
    if (v === undefined || v === "" || v === null) continue;
    config[f.name] = f.kind === "number" ? Number(v) : str(v, 1000);
  }
  const target = config.feed_url ?? config.base_url;
  const hosts = Array.isArray(x.allowed_hosts) && x.allowed_hosts.length
    ? x.allowed_hosts.map((h) => str(h, 253).toLowerCase())
    : target && hostOf(target)
    ? [hostOf(target)!]
    : [];
  return {
    id: str(x.id, 63).toLowerCase(),
    label: str(x.label, 200),
    publisher_id: str(x.publisher_id, 63) || null,
    aggregator: false,
    adapter,
    mode: spec?.mode ?? "corpus",
    config,
    allowed_hosts: hosts,
    credential_env: str(x.credential_env, 64) || null,
    required: x.required === true,
    capabilities: ["documents"],
    doc_kind: x.doc_kind === "standing_state" ? "standing_state" : "dated_statement",
    freshness_days: x.freshness_days ? Number(x.freshness_days) : null,
    active: true,
  };
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

function fail(c: Context, err: unknown) {
  if (err instanceof RegistryValidationError) return c.json({ error: "invalid", errors: err.errors }, 400);
  if (err instanceof RegistryUnavailableError) {
    return c.json({ error: "registry_unavailable", reason: err.reason, message: err.message }, 503);
  }
  return c.json({ error: "failed", message: (err as Error).message }, 500);
}

export function mountRegistryRoutes(app: Hono, d: RegistryRoutesDeps) {
  const { access, ingestor } = d;
  const admin = (handler: (c: Context) => Promise<Response>) => async (c: Context) => {
    const denied = await d.adminDenied(c);
    if (denied) return denied;
    try {
      return await handler(c);
    } catch (err) {
      return fail(c, err);
    }
  };

  app.get(
    "/api/v1/admin/registry",
    admin(async (c) => {
      const reg = await access.store.read();
      return c.json({
        revision: reg.revision,
        published_at: reg.published_at,
        published_by: reg.published_by,
        publishers: reg.publishers,
        bindings: reg.bindings,
        links: reg.links,
        sync: reg.bindings.filter((b) => b.adapter === "rss").map((b) => ingestor.status(b.id)),
        drafts: await access.store.listDrafts(),
        ...access.adapters(),
        audit: await access.store.audit(50),
        backends: {
          registry: access.store.kind,
          corpus: access.corpus.backend,
          corpus_revision: await access.corpusRevision(),
        },
        note: "Tożsamość operatora z nagłówka X-Operator: tylko prototyp.",
      });
    }),
  );

  app.post(
    "/api/v1/admin/registry/drafts",
    admin(async (c) => {
      const b = await body(c);
      const reg = await access.store.read();
      const change: Draft["change"] = {};
      if (b.publisher && typeof b.publisher === "object") {
        change.publisher = draftPublisher(b.publisher as Record<string, unknown>);
      }
      if (b.binding && typeof b.binding === "object") {
        change.binding = draftBinding(b.binding as Record<string, unknown>);
      }
      if (Array.isArray(b.links)) {
        change.links = b.links.slice(0, 50).map((l: Record<string, unknown>): AggregatorLink => ({
          binding_id: str(l?.binding_id, 63),
          publisher_id: str(l?.publisher_id, 63),
          active: l?.active !== false,
        }));
      }
      if (!change.publisher && !change.binding && !change.links?.length) {
        return c.json({
          error: "invalid",
          errors: ["szkic musi zawierać wydawcę, powiązanie lub połączenie"],
        }, 400);
      }
      if (change.binding && !change.binding.publisher_id && change.publisher) {
        change.binding.publisher_id = change.publisher.id;
      }
      const draft: Draft = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        created_by: operatorOf(c),
        base_revision: reg.revision,
        change,
        sample: null,
      };
      // Report problems early; they block sample and activation, not the draft itself.
      const merged = structuredClone({
        publishers: reg.publishers,
        bindings: reg.bindings,
        links: reg.links,
      });
      applyDraft(merged, change);
      await access.store.saveDraft(draft);
      await access.store.note(
        draft.created_by,
        "draft",
        `szkic ${draft.id.slice(0, 8)}: ${
          [change.publisher?.id, change.binding?.id].filter(Boolean).join(" + ")
        }`,
      );
      return c.json({ draft, errors: validateRegistry(merged) }, 201);
    }),
  );

  app.post(
    "/api/v1/admin/registry/drafts/:id/sample",
    admin(async (c) => {
      const draft = await access.store.getDraft(param(c, "id"));
      if (!draft) return c.json({ error: "not found" }, 404);
      const query = str((await body(c)).query, 300);
      const res = await access.sampleDraft(draft, query);
      draft.sample = {
        at: new Date().toISOString(),
        query,
        ok: res.ok,
        records: res.records.length,
        eligible: res.records.filter((r) => r.eligible).length,
        errors: res.errors,
      };
      await access.store.saveDraft(draft);
      return c.json({ ...res, draft });
    }),
  );

  app.post(
    "/api/v1/admin/registry/drafts/:id/activate",
    admin(async (c) => {
      const draft = await access.store.getDraft(param(c, "id"));
      if (!draft) return c.json({ error: "not found" }, 404);
      const reg = await access.activateDraft(draft, operatorOf(c));
      return c.json({ revision: reg.revision });
    }),
  );

  app.delete(
    "/api/v1/admin/registry/drafts/:id",
    admin(async (c) => {
      const ok = await access.store.deleteDraft(param(c, "id"));
      if (ok) {
        await access.store.note(
          operatorOf(c),
          "draft_delete",
          `szkic ${param(c, "id").slice(0, 8)} usunięty`,
        );
      }
      return c.json({ deleted: ok }, ok ? 200 : 404);
    }),
  );

  const toggle = (kind: "publisher" | "binding" | "link") =>
    admin(async (c) => {
      const active = (await body(c)).active;
      if (typeof active !== "boolean") {
        return c.json({ error: "invalid", errors: ['pole "active": true|false'] }, 400);
      }
      const id = kind === "link" ? `${param(c, "binding")}→${param(c, "publisher")}` : param(c, "id");
      let found = false;
      const reg = await access.store.publish(
        operatorOf(c),
        active ? "enable" : "disable",
        `${kind} ${id}`,
        (next) => {
          const target = kind === "publisher"
            ? next.publishers.find((p) => p.id === id)
            : kind === "binding"
            ? next.bindings.find((b) => b.id === id)
            : next.links.find((l) =>
              l.binding_id === param(c, "binding") && l.publisher_id === param(c, "publisher")
            );
          if (target) {
            target.active = active;
            found = true;
          }
        },
      );
      if (!found) {
        return c.json({ error: "not found" }, 404);
      }
      return c.json({ revision: reg.revision, [kind]: id, active });
    });
  app.post("/api/v1/admin/publishers/:id/active", toggle("publisher"));
  app.post("/api/v1/admin/bindings/:id/active", toggle("binding"));
  app.post("/api/v1/admin/links/:binding/:publisher/active", toggle("link"));

  app.post(
    "/api/v1/admin/bindings/:id/sync",
    admin(async (c) => {
      return c.json(await ingestor.sync(param(c, "id"), operatorOf(c)));
    }),
  );

  app.post(
    "/api/v1/admin/bindings/:id/documents",
    admin(async (c) => {
      const b = await body(c);
      const res = await access.upload(param(c, "id"), {
        document_id: str(b.document_id, 200) || undefined,
        title: str(b.title, 400),
        canonical_url: str(b.canonical_url, 2000),
        text: typeof b.text === "string" ? b.text.slice(0, 200_000) : "",
        published_at: str(b.published_at, 40) || null,
        effective_from: str(b.effective_from, 10) || null,
        effective_to: str(b.effective_to, 10) || null,
        kind: b.kind === "standing_state"
          ? "standing_state"
          : b.kind === "dated_statement"
          ? "dated_statement"
          : undefined,
      }, operatorOf(c));
      return c.json(res, 201);
    }),
  );

  app.get(
    "/api/v1/admin/corpus",
    admin(async (c) => {
      const q = c.req.query();
      return c.json(
        await access.corpus.list({
          publisher_id: q.publisher_id || undefined,
          binding_id: q.binding_id || undefined,
          q: q.q || undefined,
          date: /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "") ? q.date : undefined,
          include_superseded: q.include_superseded === "1" || q.include_superseded === "true",
          limit: Math.min(Math.max(Number(q.limit) || 100, 1), 500),
        }),
      );
    }),
  );

  app.get(
    "/api/v1/admin/corpus/versions",
    admin(async (c) => {
      const id = c.req.query("document_id") ?? "";
      const versions = id ? await access.corpus.history(id) : null;
      if (!versions) return c.json({ error: "not found" }, 404);
      return c.json({ document_id: id, versions });
    }),
  );

  app.post(
    "/api/v1/admin/evidence/probe",
    admin(async (c) => {
      const b = await body(c);
      const text = str(b.text, 2000);
      if (!text) return c.json({ error: "invalid", errors: ['pole "text" jest wymagane'] }, 400);
      const type = ["numeric", "legal", "parliamentary", "official_statement", "event", "narrative"].includes(
          String(b.type),
        )
        ? b.type as "legal"
        : null;
      return c.json(
        await access.probe({
          text,
          type,
          time: str(b.time, 10) || undefined,
          indicator: str(b.indicator, 60) || null,
          geo: str(b.geo, 3).toUpperCase() || null,
          currency: str(b.currency, 3).toUpperCase() || null,
        }),
      );
    }),
  );
}
