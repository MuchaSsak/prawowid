/**
 * Code-side number check for official data records (connectors with `data`). The model labels the
 * passage; this compares the claimed number with the official value for the claim's period and
 * only ever DOWNGRADES a stance that the numbers contradict (to "context"). It never upgrades a
 * stance: a different statistic with the same name (registered vs survey unemployment, CPI vs HICP)
 * must not turn into a confident "false" without the model's quoted reading.
 * One narrow exception: NBP's own rates (exchange rate, gold, reference rate) have a single official
 * definition, so a "context" or "refutes" reading of a record whose value equals the claim at the claim's
 * precision, for the claim's own period, is support (the model files an exact table line as context or
 * reads rounding as a different number).
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
}

/** Indicators with one official definition, published by the institution itself. */
const SINGLE_DEFINITION = new Set(["exchange_rate", "gold_price", "nbp_reference_rate"]);

export function numericGuard(claimed: number | null, passages: VerifiedPassage[]): NumericGuardResult {
  const warnings: Warning[] = [];
  const downgrades: NumericGuardResult["downgrades"] = [];
  const out = passages.map((p) => {
    const data = p.record.data;
    if (!data || p.stance === "irrelevant") return p;
    const { match, period } = compareNumber(claimed, data);
    // NBP's own rates: the value equals the claim at the claim's precision for the claim's period, so a
    // "context" or "refutes" reading (the model does not treat 4,26 as 4,2578 rounded) is support.
    if ((p.stance === "context" || p.stance === "refutes") && match === "matches" && SINGLE_DEFINITION.has(data.indicator) && p.quote) {
      downgrades.push({ source_id: p.record.source_id, from: p.stance, match });
      return { ...p, stance: "supports" as const };
    }
    if (p.stance === "context") return p;
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
  return { passages: out, warnings, downgrades };
}
