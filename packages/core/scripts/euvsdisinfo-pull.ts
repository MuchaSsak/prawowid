/**
 * Bulk pull of every EUvsDisinfo case (and optionally articles) into JSONL of KnownIncident rows,
 * the input for the future Supabase loader (corpus schema, decision 001). Resumable: re-running skips
 * pages already written. Newest first, so `--max` gives the latest N.
 *
 * Run from the repo root (the key is read from .env by Deno, never printed):
 *   deno run --env-file=.env --allow-env --allow-net --allow-read --allow-write \
 *     packages/core/scripts/euvsdisinfo-pull.ts [--articles] [--max=1000] [--out=data/euvsdisinfo]
 *
 * Output (gitignored): data/euvsdisinfo/cases.jsonl, articles.jsonl, meta.json (counts, retrieved_at, timing).
 * Third-party content: store and show with attribution and a link back (wiki data-sources-research).
 */
import { articleToIncident, caseToIncident, listArticles, listCases } from "../src/narratives/euvsdisinfo/client.ts";
import type { KnownIncident } from "../src/narratives/types.ts";

const arg = (name: string) => Deno.args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const OUT = arg("out") ?? "data/euvsdisinfo";
const MAX = Number(arg("max") ?? Infinity);
const PAGE = 100;

const token = Deno.env.get("EUVSDISINFO_TOKEN")?.trim();
if (!token) {
  console.error("EUVSDISINFO_TOKEN is not set (run with --env-file=.env).");
  Deno.exit(1);
}
await Deno.mkdir(OUT, { recursive: true });

async function existingCount(path: string): Promise<number> {
  try {
    return (await Deno.readTextFile(path)).split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function pull<T>(
  kind: "cases" | "articles",
  list: (offset: number, limit: number, opt: { token: string; signal: AbortSignal; timeoutMs: number }) => Promise<{ items: T[]; total: number | null; hasNextPage: boolean }>,
  map: (x: T, at: string) => KnownIncident,
) {
  const path = `${OUT}/${kind}.jsonl`;
  // Resume from whole pages only, so a partial last page is fetched again (duplicates are fine for an upsert).
  let offset = Math.floor((await existingCount(path)) / PAGE) * PAGE;
  let total: number | null = null;
  const times: number[] = [];
  const file = await Deno.open(path, { create: true, append: true });
  const enc = new TextEncoder();
  try {
    while (offset < MAX) {
      const t0 = Date.now();
      const page = await list(offset, Math.min(PAGE, MAX - offset), { token: token!, signal: new AbortController().signal, timeoutMs: 30_000 });
      times.push(Date.now() - t0);
      total = page.total ?? total;
      const at = new Date().toISOString();
      await file.write(enc.encode(page.items.map((x) => JSON.stringify(map(x, at))).join("\n") + (page.items.length ? "\n" : "")));
      offset += page.items.length;
      console.log(`${kind}: ${offset}/${total ?? "?"} (${times.at(-1)} ms)`);
      if (!page.hasNextPage || page.items.length === 0) break;
      await new Promise((r) => setTimeout(r, 200)); // be gentle with their server
    }
  } finally {
    file.close();
  }
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  return { kind, written_through: offset, total, avg_ms_per_page: avg };
}

const results = [await pull("cases", listCases, caseToIncident)];
if (Deno.args.includes("--articles")) results.push(await pull("articles", listArticles, articleToIncident));
await Deno.writeTextFile(`${OUT}/meta.json`, JSON.stringify({ retrieved_at: new Date().toISOString(), source: "https://mcp.euvsd.info/mcp", results }, null, 2));
console.log(JSON.stringify(results));
