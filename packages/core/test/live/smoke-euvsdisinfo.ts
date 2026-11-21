/**
 * Manual live smoke test of the EUvsDisinfo MCP: raw `search` shape, matcher output, one cases page.
 * Free (no model). The key is read from .env by Deno and never printed.
 * Run from the repo root:
 *   deno run --env-file=.env --allow-env --allow-net packages/core/test/live/smoke-euvsdisinfo.ts ["english query"]
 */
import { callTool, listCases } from "../../src/narratives/euvsdisinfo/client.ts";
import { euvsdisinfoLive } from "../../src/narratives/euvsdisinfo/live.ts";
import { loadConfig } from "../../src/mod.ts";

const config = loadConfig({ get: (k) => Deno.env.get(k) });
const token = config.secrets.euvsdisinfoToken;
if (!token) {
  console.error("EUVSDISINFO_TOKEN is not set (run with --env-file=.env).");
  Deno.exit(1);
}
const opt = { token, signal: new AbortController().signal, timeoutMs: 15_000 };
const query = Deno.args[0] ?? "Poland sends troops to Ukraine";

let t0 = Date.now();
const raw = await callTool("search", { query }, opt);
console.log(`\n## search raw payload (${Date.now() - t0} ms), first 800 chars:`);
console.log(JSON.stringify(raw).slice(0, 800));

t0 = Date.now();
const matches = await euvsdisinfoLive.match(
  { text: query, type: "narrative", time: "unknown", entities: [], search_queries_pl: [], search_query_en: query, indicator: null, geo: null, claimed_value: null, currency: null },
  { config, signal: opt.signal },
);
console.log(`\n## matcher (${Date.now() - t0} ms): ${matches.length} match(es)`);
for (const m of matches) console.log(`- [${m.score}] ${m.title}\n  ${m.url}`);

t0 = Date.now();
const page = await listCases(0, 100, opt);
console.log(`\n## cases page of 100 (${Date.now() - t0} ms): items=${page.items.length}, total=${page.total}, hasNextPage=${page.hasNextPage}`);
console.log(`newest: ${page.items[0]?.title}`);
