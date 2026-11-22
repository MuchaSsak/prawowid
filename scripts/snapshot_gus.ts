/**
 * Saves a copy of every GUS BDL variable the stats catalog uses into
 * packages/core/src/connectors/gus-snapshot.ts. The GUS connector falls back to this copy (and says
 * so, with its date) when the live service is down, which happens often (TLS resets).
 *
 *   deno run --allow-net --allow-write scripts/snapshot_gus.ts [--retries 20] [--wait-ms 60000]
 *
 * Only real API responses are written; on failure the existing snapshot stays untouched.
 */
import { INDICATORS } from "../packages/core/src/connectors/stats-catalog.ts";

const args = new Map<string, string>();
for (let i = 0; i < Deno.args.length; i += 2) args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1]);
const retries = Number(args.get("retries") ?? 5);
const waitMs = Number(args.get("wait-ms") ?? 30_000);
const OUT = new URL("../packages/core/src/connectors/gus-snapshot.ts", import.meta.url);

interface Bdl {
  lastUpdate?: string;
  results?: { values: { year: string; val: number }[] }[];
}

async function fetchVar(id: number): Promise<Bdl> {
  const url = `https://bdl.stat.gov.pl/api/v1/data/by-variable/${id}?unit-level=0&format=json&page-size=100`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as Bdl;
  if (!Array.isArray(j.results?.[0]?.values) || !j.results![0].values.length) throw new Error("no values");
  return j;
}

const vars = [...new Set(INDICATORS.map((i) => i.gus_var).filter((v): v is number => typeof v === "number"))];
const snapshot: Record<number, { retrieved_at: string; last_update: string | null; values: { year: string; val: number }[] }> = {};
for (const id of vars) {
  for (let attempt = 1; ; attempt++) {
    try {
      const j = await fetchVar(id);
      snapshot[id] = {
        retrieved_at: new Date().toISOString(),
        last_update: j.lastUpdate ?? null,
        values: j.results![0].values.filter((v) => typeof v.val === "number").map((v) => ({ year: String(v.year), val: v.val })),
      };
      console.log(`GUS ${id}: ${snapshot[id].values.length} values`);
      break;
    } catch (e) {
      console.log(`GUS ${id}: attempt ${attempt}/${retries} failed: ${(e as Error).message}`);
      if (attempt >= retries) {
        console.log("Snapshot not written (the existing one stays).");
        Deno.exit(1);
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

await Deno.writeTextFile(
  OUT,
  `/**
 * Copy of the GUS BDL values the stats catalog uses, written by scripts/snapshot_gus.ts from real API
 * responses. Used only when the live service fails; the record then says it is a copy and its date.
 */
export interface GusSnapshotEntry {
  retrieved_at: string;
  last_update: string | null;
  values: { year: string; val: number }[];
}

export const GUS_SNAPSHOT: Record<number, GusSnapshotEntry> = ${JSON.stringify(snapshot, null, 2)};
`,
);
console.log(`Written ${OUT.pathname}`);
