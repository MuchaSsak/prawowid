/**
 * Manual live smoke test of the statistics routes (Eurostat, NBP, GUS). Free: no model, no keys.
 * Run: deno run --allow-net packages/core/test/live/smoke-stats.ts
 */
import { eurostat } from "../../src/connectors/eurostat.ts";
import { gus } from "../../src/connectors/gus.ts";
import { nbp } from "../../src/connectors/nbp.ts";
import { INDICATORS } from "../../src/connectors/stats-catalog.ts";
import type { ClaimQuery, Connector } from "../../src/connectors/types.ts";
import { loadConfig, MemoryCorpusStore } from "../../src/mod.ts";

const ctx = { config: loadConfig({ get: () => undefined }), signal: new AbortController().signal, corpus: new MemoryCorpusStore() };
const q = (indicator: string, time: string, extra: Partial<ClaimQuery> = {}): ClaimQuery => ({
  text: "", type: "numeric", time, entities: [], search_queries_pl: [], search_query_en: "", indicator, geo: "PL", claimed_value: null, currency: null, ...extra,
});

async function run(c: Connector, query: ClaimQuery, label: string, full = false) {
  const t0 = Date.now();
  try {
    const recs = await c.search(query, ctx);
    const r = recs[0];
    console.log(`\n## ${label} [${c.id}] ${Date.now() - t0} ms, records=${recs.length}, targets=${r?.data?.target_periods.join(",")}`);
    if (r) console.log(full ? r.text : r.text.split("\n").filter((l) => /^\d|Unia|Najniż|miejsce|obowiąz|Średnia|Brak/.test(l)).join("\n"));
  } catch (e) {
    console.log(`\n## ${label} [${c.id}] ERROR ${(e as Error).message}`);
  }
}

for (const ind of INDICATORS.filter((i) => i.eurostat)) await run(eurostat, q(ind.key, "2024"), ind.key, ind.key === "unemployment_rate");
await run(eurostat, q("inflation", "2024", { geo: "DE" }), "inflation DE");
await run(eurostat, q("unemployment_rate", "unknown", { geo: "EU" }), "unemployment EU latest");
await run(nbp, q("exchange_rate", "2025-06-07", { currency: "EUR" }), "EUR on a Saturday", true);
await run(nbp, q("exchange_rate", "2024", { currency: "USD" }), "USD year 2024", true);
await run(nbp, q("gold_price", "2025-06"), "gold June 2025", true);
await run(nbp, q("nbp_reference_rate", "2024"), "reference rate 2024", true);
await run(nbp, q("nbp_reference_rate", "unknown"), "reference rate now", true);
await run(gus, q("population", "2024"), "population GUS", true);
