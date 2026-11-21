/**
 * Guilloche rosette: the fine-line pattern of security printing (banknotes, ID cards), used as
 * Prawdowid's mark because the product's job is checking whether something is genuine.
 * Built from phase-shifted sine rings, so it is pure geometry (no image asset) and scales cleanly.
 */
export interface RosetteOptions {
  /** Number of interlaced rings. More rings = denser weave. */
  rings: number;
  /** Waves around each ring. */
  lobes: number;
  /** Mean radius and wave amplitude of the outer band, in viewBox units (viewBox is -100..100). */
  radius: number;
  amplitude: number;
  /** Optional inner band (same weave, smaller), 0 to skip. */
  innerRadius?: number;
  innerAmplitude?: number;
  innerLobes?: number;
  /** Points per ring; fewer for tiny renders such as the favicon. */
  steps?: number;
}

function ring(r0: number, amp: number, lobes: number, phase: number, steps = 360): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    // A second, faster harmonic keeps the weave from looking like a plain flower.
    const r = r0 + amp * Math.sin(lobes * t + phase) + amp * 0.35 * Math.sin((lobes * 2 + 1) * t - phase * 2);
    d += `${i ? "L" : "M"}${(r * Math.cos(t)).toFixed(1)} ${(r * Math.sin(t)).toFixed(1)}`;
  }
  return d + "Z";
}

/** Path data for every line of the rosette. Render each as an unfilled stroked <path>. */
export function rosettePaths(o: RosetteOptions): string[] {
  const out: string[] = [];
  for (let i = 0; i < o.rings; i++) {
    out.push(ring(o.radius, o.amplitude, o.lobes, (i / o.rings) * Math.PI * 2, o.steps));
  }
  if (o.innerRadius) {
    const n = Math.max(4, Math.round(o.rings / 2));
    for (let i = 0; i < n; i++) {
      out.push(ring(o.innerRadius, o.innerAmplitude ?? 8, o.innerLobes ?? o.lobes, (i / n) * Math.PI * 2, o.steps));
    }
  }
  return out;
}

/** Named presets: a sparse mark that still reads at 28 px (logo, reply avatar, feature tile). */
export const ROSETTES: Record<"mark", RosetteOptions> = {
  mark: { rings: 7, lobes: 6, radius: 66, amplitude: 16, innerRadius: 28, innerAmplitude: 10, innerLobes: 4, steps: 120 },
};

/**
 * Fills every `<svg data-rosette="mark">` with its paths. Drawn in the browser on purpose: the
 * path data inlined in the HTML would weigh far more than this function.
 */
export function drawRosettes(root: ParentNode = document) {
  const ns = "http://www.w3.org/2000/svg";
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg[data-rosette]")) {
    const preset = ROSETTES[svg.dataset.rosette as keyof typeof ROSETTES];
    if (!preset || svg.childElementCount) continue;
    for (const d of rosettePaths(preset)) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
  }
}
