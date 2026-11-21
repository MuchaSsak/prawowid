/**
 * Live matcher: the EUvsDisinfo MCP `search` tool, called at check time with the claim's English query
 * (the catalog is mostly English). Keyword search, so it misses paraphrases and Polish-only wording;
 * the corpus matcher (corpus.ts) is preferred once our own index is filled (narratives/mod.ts).
 */
import { LIMITS } from "../../config.ts";
import type { ContextMatch } from "../../types.ts";
import { overlapScore, queryTerms, relevant } from "../score.ts";
import type { NarrativeMatcher } from "../types.ts";
import { search } from "./client.ts";

export const MAX_CONTEXT_MATCHES = 2;
const EXCERPT_CHARS = 300;

export const euvsdisinfoLive: NarrativeMatcher = {
  id: "euvsdisinfo_live",
  catalog: "EUvsDisinfo",
  label: "EUvsDisinfo (znane przekazy dezinformacyjne, kontekst)",
  unavailableReason: (ctx) => (ctx.config.secrets.euvsdisinfoToken ? null : "brak klucza EUVSDISINFO_TOKEN"),

  async match(claim, ctx) {
    const q = claim.search_query_en.trim();
    if (q.length < 3) return [];
    const hits = await search(q, {
      token: ctx.config.secrets.euvsdisinfoToken!,
      signal: ctx.signal,
      timeoutMs: LIMITS.connectorTimeoutMs,
    });
    const terms = queryTerms(claim);
    return hits
      // Cases only: a case is a documented disinformation claim; articles are broader analyses.
      .filter((h) => h.type === "claim_review")
      .map((h) => ({ h, s: overlapScore(terms, `${h.title} ${h.content.slice(0, 600)}`) }))
      .filter((x) => relevant(x.s))
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, MAX_CONTEXT_MATCHES)
      .map(({ h, s }): ContextMatch => ({
        kind: "known_incident",
        catalog: "EUvsDisinfo",
        record_type: "case",
        title: h.title,
        url: h.link,
        published_at: null,
        excerpt: h.content.length > EXCERPT_CHARS ? `${h.content.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : h.content,
        route: "euvsdisinfo_live",
        match: "keyword",
        score: Math.round(s.score * 100) / 100,
      }));
  },
};
