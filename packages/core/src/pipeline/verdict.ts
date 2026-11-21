/**
 * Code-owned verdict rules (verification-pipeline.md §5). The model only labels passages; this
 * decides. Rules, in order:
 *   1. both sides meet the threshold          → insufficient_evidence + sources_conflict
 *   2. "misleading" meets the threshold       → misleading
 *   3. support meets the threshold            → confirmed
 *   4. refutation meets the threshold         → false
 *   5. otherwise                              → insufficient_evidence
 *
 * Threshold: one qualifying primary source (tier "official"), or one fact-check (interim policy,
 * see open-questions.md: the prompt counts a fact-check as enough, the pipeline draft wants its
 * demonstrated evidence), or two independent origins of any tier.
 */
import type { SourceTier, Stance, Strength, Verdict, Warning } from "../types.ts";
import type { VerifiedPassage } from "./assess.ts";

const SUFFICIENT_ALONE: SourceTier[] = ["official", "factcheck"];

export interface VerdictDecision {
  verdict: Exclude<Verdict, "not_verifiable">;
  rule: string;
  strength: Strength;
  warnings: Warning[];
  /** Passages that carry the decision (shown first). */
  decisive: VerifiedPassage[];
}

function groups(passages: VerifiedPassage[], stance: Stance) {
  const map = new Map<string, VerifiedPassage[]>();
  for (const p of passages) {
    if (p.stance !== stance) continue;
    map.set(p.record.origin_key, [...(map.get(p.record.origin_key) ?? []), p]);
  }
  return [...map.values()];
}

function meets(gs: VerifiedPassage[][]): boolean {
  return gs.length >= 2 || gs.some((g) => g.some((p) => SUFFICIENT_ALONE.includes(p.record.tier)));
}

function publishers(ps: VerifiedPassage[]): string {
  return [...new Set(ps.map((p) => p.record.publisher))].join(", ");
}

export function decideVerdict(passages: VerifiedPassage[], opts: { optionalRouteMissing: boolean }): VerdictDecision {
  const sup = groups(passages, "supports");
  const ref = groups(passages, "refutes");
  const mis = groups(passages, "misleading");
  const flat = (gs: VerifiedPassage[][]) => gs.flat();
  const warnings: Warning[] = [];

  const strengthFor = (decisive: VerifiedPassage[][], dissent: VerifiedPassage[][]): Strength => {
    const reasons: string[] = [];
    const ps = flat(decisive);
    if (ps.some((p) => p.record.tier === "official")) reasons.push(`oficjalne źródło: ${publishers(ps.filter((p) => p.record.tier === "official"))}`);
    if (ps.some((p) => p.record.tier === "factcheck")) reasons.push(`weryfikacja faktów: ${publishers(ps.filter((p) => p.record.tier === "factcheck"))}`);
    reasons.push(decisive.length >= 2 ? `${decisive.length} niezależne źródła` : "jedno źródło");
    const years = ps.map((p) => p.record.published_at?.slice(0, 4)).filter(Boolean);
    if (years.length) reasons.push(`źródła z lat: ${[...new Set(years)].sort().join(", ")}`);
    const caveats: string[] = [];
    if (dissent.length) caveats.push("część źródeł mówi co innego");
    if (opts.optionalRouteMissing) caveats.push("nie wszystkie bazy źródeł są jeszcze podłączone");
    if (decisive.length < 2 && !ps.some((p) => p.record.tier === "official")) caveats.push("tylko jedno źródło");
    reasons.push(...caveats);
    return { level: caveats.length === 0 ? "high" : "medium", reasons };
  };

  // Interim refinement (wiki: verification-pipeline §5): direct support and a "misleading" reading
  // that both meet the threshold contradict each other too, so they are treated as a conflict.
  const against = meets(ref) ? ref : meets(mis) ? mis : null;
  if (meets(sup) && against) {
    warnings.push({
      type: "sources_conflict",
      text: `Źródła są ze sobą sprzeczne: ${publishers(flat(sup))} vs ${publishers(flat(against))}.`,
    });
    return {
      verdict: "insufficient_evidence",
      rule: against === ref ? "conflict" : "conflict_support_vs_misleading",
      strength: { level: "low", reasons: ["źródła sobie przeczą"] },
      warnings,
      decisive: [...flat(sup), ...flat(against)],
    };
  }
  if (meets(mis)) {
    return { verdict: "misleading", rule: "misleading_threshold", strength: strengthFor(mis, ref), warnings, decisive: flat(mis) };
  }
  if (meets(sup)) {
    if (ref.length) warnings.push({ type: "sources_conflict", text: `Część źródeł temu przeczy: ${publishers(flat(ref))}.` });
    return { verdict: "confirmed", rule: "support_threshold", strength: strengthFor(sup, ref), warnings, decisive: flat(sup) };
  }
  if (meets(ref)) {
    if (sup.length) warnings.push({ type: "sources_conflict", text: `Część źródeł to potwierdza: ${publishers(flat(sup))}.` });
    return { verdict: "false", rule: "refute_threshold", strength: strengthFor(ref, sup), warnings, decisive: flat(ref) };
  }
  return {
    verdict: "insufficient_evidence",
    rule: "below_threshold",
    strength: { level: "low", reasons: passages.some((p) => p.stance !== "irrelevant") ? ["dowody poniżej progu"] : ["brak pasujących źródeł"] },
    warnings,
    decisive: passages.filter((p) => p.stance !== "irrelevant"),
  };
}
