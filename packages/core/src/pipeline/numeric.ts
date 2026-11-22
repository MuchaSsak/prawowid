/**
 * Code-side number check for official data records (connectors with `data`). The model labels the
 * passage; this compares the claimed number with the official value for the claim's period and
 * DOWNGRADES a stance that the numbers contradict (to "context"). It upgrades a stance only for an
 * `exact` record (one official definition, e.g. an NBP mid rate on a date): a different statistic
 * with the same name (registered vs survey unemployment, CPI vs HICP) must never turn into a
 * confident verdict without the model's quoted reading.
 */
import type { RecordData } from "../connectors/types.ts";
import type { Warning } from "../types.ts";
import type { VerifiedPassage } from "./assess.ts";

/** Half a unit of the claim's stated precision ("3%" → 0.5, "2,9%" → 0.05, "37 mln" → 500 000), or 2%. */
export function tolerance(claimed: number, kind: RecordData["kind"]): number {
  const abs = Math.abs(claimed);
  const s = String(abs);
  let half: number;
  if (s.includes("e")) half = abs * 0.005;
  else if (s.includes(".")) half = 0.5 * 10 ** -s.split(".")[1].length;
  else half = abs === 0 ? 0.5 : 0.5 * 10 ** (s.match(/0*$/)![0].length);
  return Math.max(half, abs * 0.02, kind === "percent" ? 0.05 : 0);
}

export type NumberMatch = "matches" | "other_period" | "differs" | "unclear" | "no_check";

export function compareNumber(claimed: number | null, data: RecordData): { match: NumberMatch; period: string | null } {
  if (claimed === null || !data.target_periods.length) return { match: "no_check", period: null };
  const norm = (v: number) => (data.compare_abs ? Math.abs(v) : v);
  const c = norm(claimed);
  const tol = tolerance(claimed, data.kind);
  const targets = data.points.filter((p) => data.target_periods.includes(p.period));
  if (!targets.length) return { match: "no_check", period: null };
  const diffs = targets.map((p) => Math.abs(norm(p.value) - c));
  if (diffs.some((d) => d <= tol)) return { match: "matches", period: null };
  const other = data.points.find((p) => !data.target_periods.includes(p.period) && Math.abs(norm(p.value) - c) <= tol);
  if (other) return { match: "other_period", period: other.period };
  if (diffs.every((d) => d > 2 * tol)) return { match: "differs", period: null };
  return { match: "unclear", period: null };
}

export interface NumericGuardResult {
  passages: VerifiedPassage[];
  warnings: Warning[];
  /** For the event log: what was downgraded and why. */
  downgrades: { source_id: string; from: string; match: NumberMatch }[];
  /** Exact records only: background passages the number settled. */
  upgrades: { source_id: string; to: string }[];
}

export function numericGuard(claimed: number | null, passages: VerifiedPassage[]): NumericGuardResult {
  const warnings: Warning[] = [];
  const downgrades: NumericGuardResult["downgrades"] = [];
  const upgrades: NumericGuardResult["upgrades"] = [];
  const out = passages.map((p) => {
    const data = p.record.data;
    if (!data || p.stance === "irrelevant") return p;
    if (data.exact) {
      // An exact record (one official definition): the value for the claim's period settles the
      // number, whatever the model read (models call 4,2578 vs "4,26" a refutation).
      const { match } = compareNumber(claimed, data);
      const stance = match === "matches" ? "supports" : match === "differs" ? "refutes" : null;
      const line = stance ? periodLine(p.record.text, data.target_periods) : null;
      if (stance && line) {
        if (stance !== p.stance) upgrades.push({ source_id: p.record.source_id, to: stance });
        return { ...p, stance, quote: line } as VerifiedPassage;
      }
    }
    if (p.stance === "context") return p;
    const { match, period } = compareNumber(claimed, data);
    let downgrade = false;
    // The number agrees with the official value, so a "refutes" reading is about something else.
    if (match === "matches" && p.stance === "refutes") downgrade = true;
    // The number does not agree, so the record cannot confirm the claim.
    if ((match === "differs" || match === "other_period" || match === "unclear") && p.stance === "supports") downgrade = true;
    if (match === "other_period" && period) {
      const text = `Podana liczba odpowiada danym za ${period}, a nie za okres, którego dotyczy twierdzenie.`;
      if (!warnings.some((w) => w.text === text)) warnings.push({ type: "archival_material", text });
    }
    if (!downgrade) return p;
    downgrades.push({ source_id: p.record.source_id, from: p.stance, match });
    return { ...p, stance: "context" as const };
  });
  // An exact record settled the number for the claim's period: no other passage can contradict a
  // fixed official value for that date, so their decisive readings become context.
  const settled = out.some((p) => p.record.data?.exact && (p.stance === "supports" || p.stance === "refutes"));
  const final = settled
    ? out.map((p) => {
      if (p.record.data?.exact || !["supports", "refutes", "misleading"].includes(p.stance)) return p;
      downgrades.push({ source_id: p.record.source_id, from: p.stance, match: "no_check" });
      return { ...p, stance: "context" as const };
    })
    : out;
  return { passages: final, warnings, downgrades, upgrades };
}

/** The record's line for the claim's period (a single target period only), quoted as the evidence. */
function periodLine(text: string, periods: string[]): string | null {
  if (periods.length !== 1) return null;
  const lines = text.split("\n").filter((l) => l.includes(periods[0]));
  return lines.length ? lines[lines.length - 1].trim() : null;
}
