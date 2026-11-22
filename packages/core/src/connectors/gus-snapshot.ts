/**
 * Copy of the GUS BDL values the stats catalog uses, written by scripts/snapshot_gus.ts from real API
 * responses. Used only when the live service fails; the record then says it is a copy and its date.
 */
export interface GusSnapshotEntry {
  retrieved_at: string;
  last_update: string | null;
  values: { year: string; val: number }[];
}

export const GUS_SNAPSHOT: Record<number, GusSnapshotEntry> = {};
