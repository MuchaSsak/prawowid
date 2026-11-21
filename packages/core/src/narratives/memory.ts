/**
 * In-memory KnownIncidentStore: keyword overlap over records added with upsert(). Empty by default.
 * Good for tests and for loading a small snapshot (e.g. the JSONL from scripts/euvsdisinfo-pull.ts);
 * the Supabase store replaces it with hybrid search.
 */
import { overlapScore, queryTerms, relevant } from "./score.ts";
import type { IncidentQuery, KnownIncident, KnownIncidentStore, ScoredIncident } from "./types.ts";

export class MemoryKnownIncidentStore implements KnownIncidentStore {
  private records = new Map<string, KnownIncident>();
  size() {
    return this.records.size;
  }
  upsert(incidents: KnownIncident[]) {
    for (const i of incidents) this.records.set(i.id, i);
    return Promise.resolve();
  }
  search(query: IncidentQuery, limit: number): Promise<ScoredIncident[]> {
    const terms = queryTerms(query.claim);
    const out: ScoredIncident[] = [];
    for (const incident of this.records.values()) {
      const s = overlapScore(terms, `${incident.title} ${incident.claim} ${incident.keywords.join(" ")}`);
      if (relevant(s)) out.push({ incident, score: s.score, match: "keyword" });
    }
    return Promise.resolve(out.sort((a, b) => b.score - a.score).slice(0, limit));
  }
}
