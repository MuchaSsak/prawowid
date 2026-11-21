// Admin analytics (decision 011): aggregation, buckets, privacy of the audit line, sample determinism.
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { type AnalyticsCheck, buildAnalytics, sampleAnalytics } from "../src/analytics/mod.ts";
import { auditLine } from "../src/store/logging.ts";
import { MemoryCheckStore } from "../src/store/memory.ts";

const NOW = new Date("2026-11-21T18:30:00Z"); // Saturday, 19:30 in Warsaw

function check(hoursAgo: number, claims: AnalyticsCheck["claims"], extra: Partial<AnalyticsCheck> = {}): AnalyticsCheck {
  return {
    created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    channel: "web",
    status: "ok",
    latency_ms: 5000,
    cost_usd: 0.001,
    claims,
    ...extra,
  };
}
const fact = (text: string, verdict: string | null, type: "numeric" | "event" = "numeric") => ({
  text,
  type,
  class: "fact" as const,
  verdict,
  system_state: verdict ? null : "source_unavailable",
});

Deno.test("analytics: counts, previous period, topics, verdict mix and repeated claims", () => {
  const rows = [
    check(1, [fact("Inflacja wyniosła 5%", "false"), fact("Kurs euro to 4,30 zł", "confirmed")]),
    check(2, [fact("Inflacja wyniosła 5%.", "false")]),
    check(3, [fact("Port zamknięty", null, "event")]),
    check(30, [fact("Stare", "confirmed")]), // previous 24 h
  ];
  const r = buildAnalytics(rows, [{ type: "injection_detected", created_at: rows[0].created_at }], { range: "24h", now: NOW });
  assertEquals(r.kpis.checks, { value: 3, prev: 1 });
  assertEquals(r.kpis.claims.value, 4);
  const numeric = r.topics.find((t) => t.topic === "numeric")!;
  assertEquals(numeric.claims, 3);
  assertEquals(numeric.prev, 1);
  assertEquals(numeric.growth, 2);
  assertEquals(numeric.verdicts.false, 2);
  assertEquals(r.topics.find((t) => t.topic === "event")!.system_states, 1);
  assertEquals(r.integrity.system_states, 1);
  assertEquals(r.integrity.injection_detected, 1);
  // Trailing punctuation does not split a repeated claim; singletons are not listed.
  assertEquals(r.top_claims.length, 1);
  assertEquals(r.top_claims[0].count, 2);
  assertEquals(r.top_claims[0].verdict, "false");
  assertEquals(r.volume.reduce((s, v) => s + v.checks, 0), 3);
  // Heatmap in Warsaw time: 17:30 UTC = 18:xx local on Saturday (index 5).
  assertEquals(r.heatmap[5][18], 1);
});

Deno.test("analytics: buckets per range, edges marked partial", () => {
  for (const [range, bucket, min, max] of [["24h", "hour", 24, 25], ["30d", "day", 30, 31], ["1y", "month", 12, 13]] as const) {
    const r = buildAnalytics([], [], { range, now: NOW });
    assertEquals(r.bucket, bucket);
    assert(r.volume.length >= min && r.volume.length <= max, `${range}: ${r.volume.length}`);
    assertEquals(new Set(r.volume.map((v) => v.key)).size, r.volume.length);
    assert(r.volume[0].partial && r.volume.at(-1)!.partial);
  }
});

Deno.test("analytics: claim text never reaches the host audit line", async () => {
  const line = await auditLine({
    check_id: "c1",
    session_hash: null,
    channel: "web",
    input_type: "text",
    masked_input: "Inflacja wyniosła 5%",
    status: "ok",
    claims: [{ id: "a", verdict: "false", system_state: null, source_ids: [], text: "Inflacja wyniosła 5%", type: "numeric", class: "fact" }],
    latency_ms: 1,
    models: [],
    prompt_versions: [],
    cost_usd: 0,
    created_at: NOW.toISOString(),
  });
  assert(!JSON.stringify(line).includes("Inflacja"));
  assertEquals(line.claims[0].type, "numeric");
});

Deno.test("analytics: store listSince, sample is deterministic and flagged", async () => {
  const store = new MemoryCheckStore();
  await store.logEvent({ check_id: "x", type: "pii_redacted", detail: {}, created_at: NOW.toISOString() });
  assertEquals((await store.listSince(new Date(NOW.getTime() - 1000))).events.length, 1);
  const a = sampleAnalytics("7d", NOW);
  const b = sampleAnalytics("7d", NOW);
  assertEquals(a, b);
  assert(a.sample);
  assert(a.kpis.checks.value > 0 && a.top_claims.length > 0);
});
