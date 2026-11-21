/**
 * Corpus matcher: our own index of every EUvsDisinfo case (KnownIncidentStore). Active as soon as the
 * store holds records; it is listed before the live matcher, so the live search then stops running. With Supabase the store does hybrid search
 * (FTS + pgvector, RRF) and the IncidentQuery carries the claim embedding: no change needed here.
 */
import type { ContextMatch } from "../../types.ts";
import type { NarrativeMatcher } from "../types.ts";
import { MAX_CONTEXT_MATCHES } from "./live.ts";

const EXCERPT_CHARS = 300;

export const euvsdisinfoCorpus: NarrativeMatcher = {
  id: "euvsdisinfo_corpus",
  catalog: "EUvsDisinfo",
  label: "EUvsDisinfo (znane przekazy dezinformacyjne, kontekst)",
  unavailableReason: (ctx) => ((ctx.incidents?.size() ?? 0) > 0 ? null : "indeks EUvsDisinfo jest pusty"),

  async match(claim, ctx) {
    const found = await ctx.incidents!.search({ claim }, MAX_CONTEXT_MATCHES);
    return found
      .filter((f) => f.incident.catalog === "EUvsDisinfo" && f.incident.record_type === "case")
      .map(({ incident: i, score, match }): ContextMatch => ({
        kind: "known_incident",
        catalog: i.catalog,
        record_type: i.record_type,
        title: i.title,
        url: i.url,
        published_at: i.published_at,
        excerpt: i.claim.length > EXCERPT_CHARS ? `${i.claim.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : i.claim,
        route: "euvsdisinfo_corpus",
        match,
        score: Math.round(score * 100) / 100,
      }));
  },
};
