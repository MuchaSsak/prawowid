// Manual end-to-end smoke test of the core with real APIs. Prints results, never keys.
// Run: deno run --allow-net --allow-env --env-file=.env packages/core/test/smoke-check.ts "<text>" [--no-google]
// --no-google marks the Google Fact Check route optional, to exercise the assessment path without its key.
import { CONNECTORS, loadConfig, MemoryCheckStore, MemoryCorpusStore, runCheck } from "../src/mod.ts";

const text = Deno.args.find((a) => !a.startsWith("--")) ?? "Sejm uchwalił ustawę o ochronie ludności i obronie cywilnej.";
if (Deno.args.includes("--no-google")) {
  const g = CONNECTORS.find((c) => c.id === "google_factcheck");
  if (g) g.required = false;
}
const store = new MemoryCheckStore();
const res = await runCheck(
  { input: { type: text.startsWith("http") ? "url" : "text", value: text } },
  { config: loadConfig({ get: (k) => Deno.env.get(k) }), store, corpus: new MemoryCorpusStore() },
);
console.log(res.status, res.system_message?.text ?? "", "|", res.summary.text);
for (const c of res.claims) {
  console.log(`- ${c.id} [${c.class}/${c.type}] ${c.text}`);
  console.log(`  => ${c.verdict_label ?? c.system_state} (${c.strength?.level ?? "-"}) ${c.explanation || c.system_message}`);
  for (const x of c.citations) console.log(`     ${x.stance} | ${x.publisher} | ${x.excerpt.slice(0, 120)} | ${x.url}`);
}
console.log(JSON.stringify(res.meta));
console.log("events:", store.events.map((e) => e.type).join(", ") || "none");
