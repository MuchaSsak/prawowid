/**
 * Benchmark: runs eval/cases.json through the real pipeline and computes the task's mandatory
 * metrics (task sec. 6, wiki hackathon/judging-and-metrics.md).
 *
 *   deno task eval                       in-process, keys from the repo-root .env
 *   deno task eval --url https://…       against a deployed API (J cases are skipped)
 *   options: --only A01,E02   --concurrency 2   --client-key <key>   --no-save
 *
 * Writes eval/results/<timestamp>.json, eval/results/latest.md and eval/results/citations-review.csv
 * (for the human citation-correctness review). Costs real money in live mode (~$0.1 per full run).
 */
import { CheckResponseSchema, loadConfig, MemoryCheckStore, MemoryCorpusStore, runCheck } from "@prawdowid/core";
import type { CheckRequest, CheckResponse, Verdict } from "@prawdowid/core";

interface Case {
  id: string;
  scenario: string;
  input: { type: "text" | "url" | "image"; value?: string; file?: string };
  gold: Verdict | null;
  attack_target?: Verdict;
  consistency?: boolean;
  local_only?: boolean;
  without_keys?: string[];
  expect_status?: string[];
  expect_claim_state?: string;
  note?: string;
}

interface Outcome {
  id: string;
  scenario: string;
  gold: Verdict | null;
  predicted: string;
  correct: boolean | null;
  status: string;
  latency_ms: number;
  cached: boolean;
  cost_usd: number;
  schema_valid: boolean;
  transport_error: string | null;
  expectation_met: boolean;
  injection_warned: boolean;
  response: CheckResponse | null;
  consistency?: { same: boolean; detail: string };
  skipped?: string;
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = Deno.args;
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = arg("--url")?.replace(/\/$/, "");
const ONLY = arg("--only")?.split(",").map((s) => s.trim());
const CONCURRENCY = Number(arg("--concurrency") ?? 2);
const CLIENT_KEY = arg("--client-key");
const SAVE = !args.includes("--no-save");
const DIR = new URL(".", import.meta.url);

const VERDICTS: Verdict[] = ["confirmed", "false", "misleading", "insufficient_evidence", "not_verifiable"];
const PRIORITY: Verdict[] = ["false", "misleading", "insufficient_evidence", "confirmed"];

// ── execution ────────────────────────────────────────────────────────────────
const store = new MemoryCheckStore();
const corpus = new MemoryCorpusStore();

async function resolveHost(h: string): Promise<string[]> {
  const r = await Promise.allSettled([Deno.resolveDns(h, "A"), Deno.resolveDns(h, "AAAA")]);
  return r.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
}

async function buildRequest(c: Case, channel: "web" | "messaging", session: string): Promise<CheckRequest> {
  let value = c.input.value ?? "";
  if (c.input.file) {
    const bytes = await Deno.readFile(new URL(c.input.file, DIR));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    value = `data:image/png;base64,${btoa(bin)}`;
  }
  return { input: { type: c.input.type, value }, channel, session_id: session };
}

async function call(c: Case, req: CheckRequest): Promise<{ res: CheckResponse | null; ms: number; error: string | null }> {
  const t0 = performance.now();
  if (!BASE) {
    const without = new Set(c.without_keys ?? []);
    const config = loadConfig({ get: (k) => (without.has(k) ? undefined : Deno.env.get(k)) });
    // Cases that change the server's keys get their own store, so a cached answer from a keyed run can't mask them.
    const res = await runCheck(req, { config, store: without.size ? new MemoryCheckStore() : store, corpus, resolveHost });
    return { res, ms: performance.now() - t0, error: null };
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (CLIENT_KEY) Object.assign(headers, { "X-Client-Key": CLIENT_KEY, "X-End-User": `eval-${c.id}-${req.channel}` });
      const r = await fetch(`${BASE}/api/v1/check`, { method: "POST", headers, body: JSON.stringify(req), signal: AbortSignal.timeout(60_000) });
      if (r.status === 429) {
        await new Promise((ok) => setTimeout(ok, 15_000));
        continue;
      }
      return { res: await r.json(), ms: performance.now() - t0, error: null };
    } catch (err) {
      return { res: null, ms: performance.now() - t0, error: (err as Error).message };
    }
  }
  return { res: null, ms: performance.now() - t0, error: "rate limited 6 times" };
}

/** Case-level prediction from the response (rule documented in the wiki: evaluation/benchmark.md). */
function predict(r: CheckResponse | null): string {
  if (!r) return "transport_error";
  if (r.status !== "ok" && r.status !== "partial") return `status:${r.status}`;
  const facts = r.claims.filter((c) => c.class === "fact");
  const verdicts = facts.map((c) => c.verdict).filter((v): v is Verdict => v !== null);
  for (const v of PRIORITY) if (verdicts.includes(v)) return v;
  if (facts.length && facts.every((c) => c.system_state)) return `state:${facts[0].system_state}`;
  if (r.claims.some((c) => c.verdict === "not_verifiable")) return "not_verifiable";
  return "no_claims";
}

function signature(r: CheckResponse | null): string {
  return JSON.stringify((r?.claims ?? []).map((c) => [c.text, c.verdict, c.system_state, c.citations.map((x) => x.source_id).sort()]));
}

async function runCase(c: Case): Promise<Outcome> {
  const base: Omit<Outcome, "predicted" | "correct" | "status" | "latency_ms" | "cached" | "cost_usd" | "schema_valid" | "transport_error" | "expectation_met" | "injection_warned" | "response"> = {
    id: c.id,
    scenario: c.scenario,
    gold: c.gold,
  };
  if (c.local_only && BASE) {
    return { ...base, predicted: "skipped", correct: null, status: "skipped", latency_ms: 0, cached: false, cost_usd: 0, schema_valid: true, transport_error: null, expectation_met: true, injection_warned: false, response: null, skipped: "needs local mode (controls the server's keys)" };
  }
  const { res, ms, error } = await call(c, await buildRequest(c, "web", `eval-web-${c.id}`));
  const predicted = predict(res);
  const schema_valid = res ? CheckResponseSchema.safeParse(res).success : false;
  let expectation_met = true;
  if (c.expect_status) expectation_met = !!res && c.expect_status.includes(res.status);
  if (c.expect_claim_state) expectation_met = expectation_met && !!res?.claims.some((x) => x.system_state === c.expect_claim_state);
  if (c.gold === null && res) {
    // No verdict may stand without evidence: every decisive verdict needs a citation.
    expectation_met = expectation_met && res.claims.every((x) => !["confirmed", "false", "misleading"].includes(x.verdict ?? "") || x.citations.length > 0);
    if (c.scenario === "J") expectation_met = expectation_met && res.claims.every((x) => x.verdict === null || x.verdict === "not_verifiable");
  }
  const out: Outcome = {
    ...base,
    predicted,
    correct: c.gold === null ? null : predicted === c.gold,
    status: res?.status ?? "transport_error",
    latency_ms: Math.round(ms),
    cached: res?.meta.cached ?? false,
    cost_usd: res?.meta.cost_usd ?? 0,
    schema_valid,
    transport_error: error,
    expectation_met,
    injection_warned: !!res?.warnings.some((w) => w.type === "injection_detected"),
    response: res,
  };
  if (c.consistency) {
    const second = await call(c, await buildRequest(c, "messaging", `eval-bot-${c.id}`));
    const same = signature(res) === signature(second.res);
    out.consistency = { same, detail: same ? "identical verdicts and citations" : `web=${predicted} messaging=${predict(second.res)}` };
  }
  return out;
}

// ── metrics ──────────────────────────────────────────────────────────────────
function macroF1(rows: Outcome[]): { f1: number; perClass: Record<string, { p: number; r: number; f1: number; n: number }> } {
  const perClass: Record<string, { p: number; r: number; f1: number; n: number }> = {};
  const classes = VERDICTS.filter((v) => rows.some((r) => r.gold === v));
  for (const v of classes) {
    const tp = rows.filter((r) => r.gold === v && r.predicted === v).length;
    const fp = rows.filter((r) => r.gold !== v && r.predicted === v).length;
    const fn = rows.filter((r) => r.gold === v && r.predicted !== v).length;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const rc = tp + fn ? tp / (tp + fn) : 0;
    perClass[v] = { p, r: rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0, n: tp + fn };
  }
  const f1 = classes.length ? classes.reduce((s, v) => s + perClass[v].f1, 0) / classes.length : 0;
  return { f1, perClass };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}% (${n}/${d})` : "n/a");
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.9))] : 0);

// ── main ─────────────────────────────────────────────────────────────────────
const all: Case[] = JSON.parse(await Deno.readTextFile(new URL("cases.json", DIR))).cases;
const cases = ONLY ? all.filter((c) => ONLY.includes(c.id)) : all;
console.log(`Running ${cases.length} cases against ${BASE ?? "the local core (in-process)"} with concurrency ${CONCURRENCY}…`);
console.log(`⚠ Live run: uses real OpenRouter/Google credits (~$0.001 per case, ~$0.04 for the full set). Use --only to run a few cases.`);

const results: Outcome[] = [];
const queue = [...cases];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const c = queue.shift()!;
    const o = await runCase(c);
    results.push(o);
    console.log(`  ${o.id.padEnd(4)} ${o.scenario}  gold=${String(o.gold).padEnd(21)} got=${o.predicted.padEnd(26)} ${o.correct === null ? (o.expectation_met ? "  ok " : " FAIL") : o.correct ? "  ✓  " : "  ✗  "} ${(o.latency_ms / 1000).toFixed(1)}s`);
  }
}));
results.sort((a, b) => a.id.localeCompare(b.id));

const ran = results.filter((r) => !r.skipped);
const labelled = ran.filter((r) => r.gold !== null);
const { f1, perClass } = macroF1(labelled);
const allClaims = ran.flatMap((r) => (r.response?.claims ?? []).map((c) => ({ case: r.id, c })));
const decisive = allClaims.filter(({ c }) => ["confirmed", "false", "misleading"].includes(c.verdict ?? ""));
const withEvidence = decisive.filter(({ c }) => c.citations.some((x) => x.stance !== "context"));
const factsWithVerdict = allClaims.filter(({ c }) => c.class === "fact" && c.verdict);
const factsCited = factsWithVerdict.filter(({ c }) => c.citations.length > 0);
const abst = labelled.filter((r) => r.gold === "insufficient_evidence");
const attacks = ran.filter((r) => r.scenario === "E");
// Repelled = the attacker's target verdict was not produced, the check completed, and the attempt was flagged.
const repelled = attacks.filter((r) =>
  r.predicted !== cases.find((c) => c.id === r.id)?.attack_target && !r.predicted.startsWith("status:") && r.injection_warned
);
const timed = ran.filter((r) => !r.cached && r.response && ["text", "url"].includes(r.response.input.type) && !r.skipped);
const lat = timed.map((r) => r.latency_ms);
const cost = ran.reduce((s, r) => s + r.cost_usd, 0);
const e2e = ran.filter((r) => !r.transport_error && r.schema_valid && r.expectation_met && (r.gold === null || !r.predicted.startsWith("status:technical")));
const cons = ran.filter((r) => r.consistency);

// Citation correctness: human labels if present (eval/labels/citations.json: { "<case>|<source_id>|<claim id>": true|false }).
let labels: Record<string, boolean> = {};
try {
  labels = JSON.parse(await Deno.readTextFile(new URL("labels/citations.json", DIR)));
} catch { /* no labels yet */ }
const citRows = allClaims.flatMap(({ case: id, c }) => c.citations.map((x) => ({ key: `${id}|${x.source_id}|${c.id}`, id, c, x })));
const labelledCits = citRows.filter((r) => r.key in labels);
const correctCits = labelledCits.filter((r) => labels[r.key]);

const confusion = VERDICTS.map((g) => {
  const row = labelled.filter((r) => r.gold === g);
  const counts = new Map<string, number>();
  for (const r of row) counts.set(r.predicted, (counts.get(r.predicted) ?? 0) + 1);
  return row.length ? `| ${g} | ${[...counts].map(([k, v]) => `${k}: ${v}`).join(", ")} |` : null;
}).filter(Boolean);

const target = BASE ?? "local core";
const now = new Date().toISOString();
const md = `# Benchmark results (${now.slice(0, 16).replace("T", " ")} UTC, ${target})
Cases: ${ran.length} run${results.length > ran.length ? `, ${results.length - ran.length} skipped` : ""} · models: ${[...new Set(ran.flatMap((r) => r.response?.meta.models ?? []))].join(", ") || "n/a"}

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (${labelled.length} labelled cases) | **${f1.toFixed(2)}** (accuracy ${pct(labelled.filter((r) => r.correct).length, labelled.length)}) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | ${pct(withEvidence.length, decisive.length)} · fact claims with any citation: ${pct(factsCited.length, factsWithVerdict.length)} | ≥ 95% |
| Citation correctness (human-labelled) | ${labelledCits.length ? pct(correctCits.length, labelledCits.length) : `not labelled yet: ${citRows.length} citations in citations-review.csv`} · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | ${pct(abst.filter((r) => r.predicted === "insufficient_evidence").length, abst.length)} | ≥ 80% |
| Robustness (injection attempts repelled) | ${pct(repelled.length, attacks.length)} | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | ${(median(lat) / 1000).toFixed(1)} s / ${(p90(lat) / 1000).toFixed(1)} s | ≤ 30 s |
| Cost | $${cost.toFixed(4)} for ${ran.length} cases → **$${(ran.length ? (cost / ran.length) * 100 : 0).toFixed(3)} per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | ${pct(e2e.length, ran.length)} | 100% |
| Channel consistency (web vs messaging) | ${pct(cons.filter((r) => r.consistency!.same).length, cons.length)} | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
${Object.entries(perClass).map(([k, v]) => `| ${k} | ${v.p.toFixed(2)} | ${v.r.toFixed(2)} | ${v.f1.toFixed(2)} | ${v.n} |`).join("\n")}

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
${confusion.join("\n")}

## Cases
| Case | Sc. | Gold | Predicted | OK | Latency | Note |
|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.id} | ${r.scenario} | ${r.gold ?? "-"} | ${r.predicted} | ${r.skipped ? "skip" : r.correct === null ? (r.expectation_met ? "✓" : "✗") : r.correct ? "✓" : "✗"} | ${(r.latency_ms / 1000).toFixed(1)} s${r.cached ? " (cache)" : ""} | ${r.skipped ?? r.consistency?.detail ?? (r.scenario === "E" ? (r.injection_warned ? "injection warned" : "NO injection warning") : r.transport_error ?? "")} |`).join("\n")}
`;

console.log("\n" + md);
if (SAVE) {
  const out = new URL("results/", DIR);
  await Deno.mkdir(out, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-").slice(0, 19);
  await Deno.writeTextFile(new URL(`${stamp}.json`, out), JSON.stringify({ target, at: now, results }, null, 2));
  await Deno.writeTextFile(new URL("latest.md", out), md);
  const esc = (s: string) => `"${s.replace(/"/g, '""').replace(/\s+/g, " ")}"`;
  const csv = ["key,case,claim,stance,publisher,excerpt,url,correct"]
    .concat(citRows.map((r) => [r.key, r.id, r.c.text, r.x.stance, r.x.publisher, r.x.excerpt, r.x.url, r.key in labels ? String(labels[r.key]) : ""].map((v) => esc(String(v))).join(",")))
    .join("\n");
  await Deno.writeTextFile(new URL("citations-review.csv", out), csv);
  console.log(`Saved eval/results/${stamp}.json, latest.md, citations-review.csv`);
}
