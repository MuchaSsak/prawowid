/** Own ingested corpus. EUvsDisinfo deliberately does not use this connector. */
import type { Connector } from "./types.ts";
import { ConnectorError } from "./types.ts";

export const corpusSearch: Connector = {
  id: "corpus",
  label: "Korpus źródeł Prawdomatu",
  required: false,
  appliesTo: () => true,
  unavailableReason: (ctx) => {
    if (ctx.corpus.size() !== 0) return null;
    const status = (ctx.corpus as { indexStatus?: () => { state: string } }).indexStatus?.();
    if (status) return null;
    return "korpus nie jest jeszcze zasilony";
  },
  async search(claim, ctx) {
    const status = (ctx.corpus as { indexStatus?: () => { state: string } }).indexStatus?.();
    if (status && status.state !== "ready") {
      throw new ConnectorError("unavailable", "Indeks korpusu jest niedostępny lub uszkodzony.");
    }
    return await ctx.corpus.search(
      [claim.text, ...claim.search_queries_pl].filter((q) => q.trim().length > 0),
      5,
      undefined,
      ctx.signal,
    );
  },
};
