/**
 * Known-incident context for one claim. Runs alongside evidence retrieval; its output never reaches
 * the assessment model or the verdict rules. See narratives/types.ts.
 */
import { ConnectorError } from "../connectors/types.ts";
import type { ClaimQuery } from "../connectors/types.ts";
import type { ContextMatch, RouteOutcome, Warning } from "../types.ts";
import { euvsdisinfoCorpus } from "./euvsdisinfo/corpus.ts";
import { euvsdisinfoLive } from "./euvsdisinfo/live.ts";
import type { NarrativeContext, NarrativeMatcher } from "./types.ts";

/** Order = preference within a catalog: the corpus index when filled, else the live search. */
export const NARRATIVE_MATCHERS: NarrativeMatcher[] = [euvsdisinfoCorpus, euvsdisinfoLive];

export interface ContextResult {
  matches: ContextMatch[];
  routes: RouteOutcome[];
  warnings: Warning[];
}

export function knownNarrativeWarning(m: ContextMatch): Warning {
  return {
    type: "known_narrative",
    text: `Podobny przekaz jest opisany w bazie ${m.catalog} (EEAS) jako przykład prokremlowskiej dezinformacji: „${m.title}”. ` +
      "To kontekst, a nie ocena tego twierdzenia.",
  };
}

export async function findContextMatches(
  claim: ClaimQuery,
  matchers: NarrativeMatcher[],
  ctx: NarrativeContext,
): Promise<ContextResult> {
  const routes: RouteOutcome[] = [];
  const matches: ContextMatch[] = [];
  // Per catalog, the first available matcher runs; if none can, the last one's reason is reported.
  const chosen: { m: NarrativeMatcher; reason: string | null }[] = [];
  for (const catalog of new Set(matchers.map((m) => m.catalog))) {
    const options = matchers.filter((m) => m.catalog === catalog).map((m) => ({ m, reason: m.unavailableReason(ctx) }));
    chosen.push(options.find((o) => o.reason === null) ?? options[options.length - 1]);
  }
  await Promise.all(chosen.map(async ({ m, reason }) => {
    // Context routes are always optional: their absence never changes a verdict or its caveats.
    const base = { route: m.id, label: m.label, required: false };
    if (reason) {
      routes.push({ ...base, status: "skipped", detail: reason });
      return;
    }
    try {
      const found = await m.match(claim, ctx);
      matches.push(...found);
      routes.push({ ...base, status: found.length ? "hits" : "no_hits" });
    } catch (err) {
      const kind = err instanceof ConnectorError ? err.kind : "error";
      const status = kind === "timeout" ? "timeout" : kind === "unavailable" ? "unavailable" : "error";
      routes.push({ ...base, status, detail: (err as Error).message });
    }
  }));
  const unique = [...new Map(matches.map((m) => [m.url, m])).values()].sort((a, b) => b.score - a.score);
  return {
    matches: unique,
    routes,
    // One note per claim is enough; the full list is in context_matches.
    warnings: unique.length ? [knownNarrativeWarning(unique[0])] : [],
  };
}

export * from "./types.ts";
export { MemoryKnownIncidentStore } from "./memory.ts";
export { articleToIncident, caseToIncident, listArticles, listCases, search as searchEuvsdisinfo } from "./euvsdisinfo/client.ts";
