/** Own ingested corpus. EUvsDisinfo deliberately does not use this connector. */
import type { CorpusStore } from "../store/types.ts";
import type { Connector, SourceRecord } from "./types.ts";
import { ConnectorError } from "./types.ts";

/** Official pages up to this size are read whole: a short notice split into chunks loses its context. */
export const PAGE_MAX_CHARS = 4000;

/**
 * A hit on a short official page becomes the whole page (its chunks joined by offset, overlaps removed),
 * one passage per page. Example: an MSZ country page split in five chunks, where the search found the
 * chunk saying "Strajk generalny ma charakter ogólnokrajowy." but not the one naming the strike's day.
 */
export function expandPages(hits: SourceRecord[], corpus: CorpusStore): SourceRecord[] {
  const seen = new Set<string>();
  const out: SourceRecord[] = [];
  for (const hit of hits) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    const chunks = hit.tier === "official" && corpus.pageOf ? corpus.pageOf(hit.url) : [];
    const offsets = chunks.length > 1 && chunks.every((c) => typeof c.start_offset === "number" && typeof c.end_offset === "number");
    const page = offsets ? joinChunks(chunks) : null;
    out.push(page && page.length <= PAGE_MAX_CHARS ? { ...hit, text: page, start_offset: 0, end_offset: page.length } : hit);
  }
  return out;
}

function joinChunks(chunks: SourceRecord[]): string {
  let text = "";
  let end = 0;
  for (const c of chunks) {
    const start = c.start_offset!;
    if (start >= end) text += (text ? " " : "") + c.text;
    else if (c.end_offset! > end) text += c.text.slice(end - start);
    end = Math.max(end, c.end_offset!);
  }
  return text;
}

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
    const hits = await ctx.corpus.search(
      [claim.text, ...claim.search_queries_pl].filter((q) => q.trim().length > 0),
      5,
      undefined,
      ctx.signal,
    );
    return expandPages(hits, ctx.corpus);
  },
};
