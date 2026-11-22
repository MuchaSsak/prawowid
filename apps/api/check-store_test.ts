/// <reference lib="deno.unstable" />
// The KV check log (check-store.ts): shared, survives restarts, deletable per session.
import { assertEquals } from "jsr:@std/assert@^1";
import type { CheckLogRow } from "@prawdowid/core";
import { KvCheckStore } from "./check-store.ts";

const row = (id: string, at: string, session: string | null): CheckLogRow => ({
  check_id: id,
  session_hash: session,
  channel: "messaging",
  platform: "discord",
  input_type: "text",
  masked_input: "x",
  status: "ok",
  claims: [],
  latency_ms: 1,
  models: [],
  prompt_versions: [],
  cost_usd: 0,
  created_at: at,
});

// Needs --unstable-kv (the root "test" script runs this file on its own with it).
Deno.test({ name: "kv check store: a second instance sees the rows, sessions delete cleanly", ignore: typeof Deno.openKv !== "function" }, async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const a = new KvCheckStore(kv as never);
    await a.saveCheck(row("1", "2026-11-20T10:00:00.000Z", "s1"));
    await a.saveCheck(row("2", "2026-11-21T10:00:00.000Z", "s2"));
    await a.logEvent({ check_id: "1", type: "pii_redacted", detail: {}, created_at: "2026-11-20T10:00:00.000Z" });
    const b = new KvCheckStore(kv as never); // another isolate, same database
    const since = await b.listSince(new Date("2026-11-19T00:00:00Z"));
    assertEquals(since.checks.map((c) => c.check_id), ["1", "2"]);
    assertEquals(since.events.length, 1);
    assertEquals((await b.listSince(new Date("2026-11-21T00:00:00Z"))).checks.map((c) => c.check_id), ["2"]);
    assertEquals((await b.listRecent(1)).map((c) => c.check_id), ["2"]);
    assertEquals(await b.deleteSession("s1"), { checks: 1 });
    const left = await a.listSince(new Date(0));
    assertEquals(left.checks.map((c) => c.check_id), ["2"]);
    assertEquals(left.events.length, 0);
  } finally {
    kv.close();
  }
});
