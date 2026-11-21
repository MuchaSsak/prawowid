/**
 * Our own ingested corpus (gov.pl, CERT, police, IMGW, EUvsDisinfo…). Today it is backed by the
 * in-memory mock store and is empty, so the route reports itself unavailable and is optional.
 * Later: Supabase hybrid search (FTS + pgvector, RRF), same interface.
 */
import type { Connector } from "./types.ts";

export const corpusSearch: Connector = {
  id: "corpus",
  label: "Korpus źródeł Prawdowidu",
  required: false,
  appliesTo: () => true,
  unavailableReason: (ctx) => (ctx.corpus.size() === 0 ? "korpus nie jest jeszcze zasilony" : null),
  async search(claim, ctx) {
    return await ctx.corpus.search([claim.text, ...claim.search_queries_pl], 5);
  },
};
