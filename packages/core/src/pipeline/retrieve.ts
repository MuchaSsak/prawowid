/** Run every applicable evidence route for one claim, in parallel, and rank the passages. */
import { LIMITS } from "../config.ts";
import { tokens } from "../guard/normalize.ts";
import type { RouteOutcome } from "../types.ts";
import {
  type ClaimQuery,
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type SourceRecord,
} from "../connectors/types.ts";

export interface RetrievalResult {
  records: SourceRecord[];
  routes: RouteOutcome[];
  /** First required route that could not complete, if any. */
  requiredFailure: RouteOutcome | null;
}

function rank(claim: ClaimQuery, records: SourceRecord[]): SourceRecord[] {
  const q = new Set(tokens([claim.text, ...claim.search_queries_pl, ...claim.entities].join(" ")));
  return records
    .map((r) => {
      const t = new Set(tokens(`${r.title} ${r.text}`));
      let s = 0;
      for (const w of q) if (t.has(w)) s++;
      return { r, s: s / Math.max(4, q.size) + (r.tier === "official" ? 0.05 : 0) };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

export async function retrieve(
  claim: ClaimQuery,
  connectors: Connector[],
  ctx: ConnectorContext,
): Promise<RetrievalResult> {
  const applicable = connectors.filter((c) => c.appliesTo(claim));
  const routes: RouteOutcome[] = [];
  const all: SourceRecord[] = [];

  await Promise.all(applicable.map(async (c) => {
    const base = { route: c.id, label: c.label, required: c.required };
    const reason = c.unavailableReason(ctx);
    if (reason) {
      // An optional route that is not set up (empty corpus) is "skipped", not a failure.
      routes.push({ ...base, status: c.required ? "unavailable" : "skipped", detail: reason });
      return;
    }
    try {
      const found = await c.search(claim, ctx);
      all.push(...found);
      routes.push({ ...base, status: found.length ? "hits" : "no_hits" });
    } catch (err) {
      const kind = err instanceof ConnectorError ? err.kind : "error";
      const status = kind === "timeout" ? "timeout" : kind === "unavailable" ? "unavailable" : "error";
      routes.push({ ...base, status, detail: (err as Error).message });
    }
  }));

  routes.sort((a, b) => applicable.findIndex((c) => c.id === a.route) - applicable.findIndex((c) => c.id === b.route));
  const requiredFailure =
    routes.find((r) => r.required && (r.status === "unavailable" || r.status === "error" || r.status === "timeout")) ??
    routes.find((r) => r.route === "corpus" && (r.status === "unavailable" || r.status === "error" || r.status === "timeout")) ??
      null;
  const unique = [...new Map(all.map((r) => [r.source_id, r])).values()];
  return { records: pickPassages(rank(claim, unique), LIMITS.passagesPerClaim), routes, requiredFailure };
}

/**
 * The passages the model reads: first the best record of every route that found something, then the
 * rest by rank. Without the reserved slot, a route that returns many loosely matching fragments (the
 * corpus) pushes out the one record a targeted route found (the Eurostat or NBP figure itself).
 */
export function pickPassages(ranked: SourceRecord[], limit: number): SourceRecord[] {
  const seenRoutes = new Set<string>();
  const firsts = ranked.filter((r) => !seenRoutes.has(r.route) && seenRoutes.add(r.route));
  const picked = new Set(firsts.slice(0, limit));
  for (const r of ranked) {
    if (picked.size >= limit) break;
    picked.add(r);
  }
  // Keep rank order in the output.
  return ranked.filter((r) => picked.has(r));
}
