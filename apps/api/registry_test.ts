// Registry admin routes through a Hono app of their own (main.ts mounts the same routes when REGISTRY_PATH is set).
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  EvidenceAccess,
  Ingestor,
  loadConfig,
  MemoryRegistryStore,
  MemoryVersionedCorpus,
  seedRegistry,
} from "@prawdowid/core";
import { mountRegistryRoutes, operatorOf } from "./registry-routes.ts";

async function setup(fetcher?: typeof fetch) {
  const store = new MemoryRegistryStore();
  await store.init(seedRegistry);
  const corpus = new MemoryVersionedCorpus();
  const fetchDeps = { fetcher, robots: () => Promise.resolve(true) };
  const access = new EvidenceAccess(store, corpus, {
    config: loadConfig({ get: () => undefined }),
    fetch: fetchDeps,
  });
  const app = new Hono();
  const adminDenied = (c: Context) =>
    Promise.resolve(
      c.req.header("authorization") === "Bearer t"
        ? null
        : c.json({ error: "unauthorized" }, 401) as Response,
    );
  mountRegistryRoutes(app, { access, ingestor: new Ingestor(store, corpus, fetchDeps), adminDenied });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://x/api/v1${path}`, {
        method,
        headers: {
          authorization: "Bearer t",
          "content-type": "application/json",
          "x-operator": "Ala <script>",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    return { status: res.status, json: await res.json() };
  };
  return { call, store, corpus, app };
}

const FEED = `<rss><channel><item><title>Komunikat</title><link>https://feed.example.org/n/1</link>
<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><description>Treść komunikatu o testach.</description></item></channel></rss>`;

Deno.test("registry routes: admin token required; operator name is sanitized", async () => {
  const { app } = await setup();
  const res = await app.fetch(new Request("http://x/api/v1/admin/registry"));
  assertEquals(res.status, 401);
  await res.body?.cancel();
  const c = { req: { header: () => "Ala <script>alert(1)</script>" } } as unknown as Context;
  assertEquals(operatorOf(c), "Ala scriptalert1script");
});

Deno.test("registry routes: draft → sample → activate an RSS source, then sync and see it in the corpus", async () => {
  const { call } = await setup(() =>
    Promise.resolve(new Response(FEED, { headers: { "content-type": "application/rss+xml" } }))
  );
  const d = await call("POST", "/admin/registry/drafts", {
    publisher: {
      id: "feed_pub",
      name: "Wydawca testowy",
      tier: "official",
      scopes: [{ host: "feed.example.org" }],
    },
    binding: {
      id: "feed_rss",
      label: "Kanał testowy",
      adapter: "rss",
      config: { feed_url: "https://feed.example.org/rss.xml" },
    },
  });
  assertEquals(d.status, 201);
  assertEquals(d.json.errors, []);
  assertEquals(d.json.draft.change.binding.allowed_hosts, ["feed.example.org"]);
  const early = await call("POST", `/admin/registry/drafts/${d.json.draft.id}/activate`);
  assertEquals(early.status, 400, "activation needs a successful sample");
  const s = await call("POST", `/admin/registry/drafts/${d.json.draft.id}/sample`, { query: "" });
  assertEquals([s.json.ok, s.json.records[0].eligible], [true, true]);
  const a = await call("POST", `/admin/registry/drafts/${d.json.draft.id}/activate`);
  assertEquals(a.status, 200);
  assertEquals(a.json.revision, 2);
  const sync = await call("POST", "/admin/bindings/feed_rss/sync");
  assertEquals([sync.json.status, sync.json.stored], ["ok", 1]);
  const corpus = await call("GET", "/admin/corpus?binding_id=feed_rss");
  assertEquals(corpus.json.documents.length, 1);
  const reg = await call("GET", "/admin/registry");
  assert(
    reg.json.audit.some((e: { action: string; operator: string }) =>
      e.action === "activate" && e.operator === "Ala script"
    ),
  );
  assertEquals(reg.json.backends.corpus, "memory");
});

Deno.test("registry routes: disable → gone from probe; upload + replace → version history", async () => {
  const { call } = await setup();
  const up = await call("POST", "/admin/bindings/policja_upload/documents", {
    title: "Komunikat o patrolach",
    canonical_url: "https://policja.pl/pol/aktualnosci/1.html",
    text: "Patrole kolejowe trwają od roku.",
  });
  assertEquals([up.status, up.json.version], [201, 1]);
  const up2 = await call("POST", "/admin/bindings/policja_upload/documents", {
    document_id: up.json.document_id,
    title: "Komunikat o patrolach",
    canonical_url: "https://policja.pl/pol/aktualnosci/1.html",
    text: "Patrole kolejowe trwają od roku i obejmują cały kraj.",
  });
  assertEquals([up2.json.version, up2.json.status], [2, "changed"]);
  const hist = await call(
    "GET",
    `/admin/corpus/versions?document_id=${encodeURIComponent(up.json.document_id)}`,
  );
  assertEquals(hist.json.versions.map((v: { version: number }) => v.version), [2, 1]);

  const before = await call("POST", "/admin/evidence/probe", { text: "patrole kolejowe" });
  assert(before.json.records.some((r: { url: string }) => r.url.includes("policja.pl")));
  const off = await call("POST", "/admin/bindings/policja_upload/active", { active: false });
  assertEquals(off.status, 200);
  const after = await call("POST", "/admin/evidence/probe", { text: "patrole kolejowe" });
  assertEquals(after.json.records.filter((r: { url: string }) => r.url.includes("policja.pl")), []);
  assert(
    after.json.routes.some((r: { route: string; status: string }) =>
      r.route === "corpus" && r.status === "skipped"
    ),
  );
  const missing = await call("POST", "/admin/bindings/nope/active", { active: false });
  assertEquals(missing.status, 404);
});
