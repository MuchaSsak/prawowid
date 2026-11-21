/**
 * Hand-built charts for the admin page (no chart library): SVG line/area with a crosshair, a
 * weekday × hour heatmap, 100% segmented bars, sparklines, thin volume bars and a shared tooltip.
 * Specs follow the dataviz skill: 2px lines, a 10% area wash, hairline grid, 4px rounded data ends,
 * 2px surface gaps, values in the tooltip, a table view for every chart. All text via textContent.
 */
import { h } from "../dom.ts";

const NS = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const nf = new Intl.NumberFormat("pl-PL");
const nfCompact = new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number) => (Math.abs(n) >= 10_000 ? nfCompact.format(n) : nf.format(Math.round(n)));

// ── tooltip ───────────────────────────────────────────────────────────────
let tip: HTMLDivElement | null = null;
export interface TipRow {
  value: string;
  label: string;
  /** CSS color for the line key; none = no key. */
  key?: string;
}
export function showTip(x: number, y: number, title: string, rows: TipRow[]) {
  tip ??= document.body.appendChild(h("div", { class: "chart-tip", role: "status" }));
  tip.replaceChildren(
    h("div", { class: "tip-title" }, title),
    ...rows.map((r) =>
      h(
        "div",
        { class: "tip-row" },
        r.key ? h("span", { class: "tip-key", style: `background:${r.key}` }) : null,
        h("strong", {}, r.value),
        h("span", {}, r.label),
      )
    ),
  );
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), innerWidth - width - 8);
  const top = y - height - 12 < 8 ? y + 16 : y - height - 12;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
export function hideTip() {
  if (tip) tip.hidden = true;
}

/** Re-draw on container resize (charts are sized to their card, not a fixed viewBox). */
const observed = new WeakMap<Element, () => void>();
const ro = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver((entries) => entries.forEach((e) => observed.get(e.target)?.()))
  : null;
function onResize(host: HTMLElement, draw: () => void) {
  observed.set(host, draw);
  ro?.observe(host);
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw)!);
  const ticks: number[] = [];
  for (let v = 0; v <= Math.ceil(max / step) * step + 1e-9; v += step) ticks.push(v);
  return ticks;
}

export function empty(text = "Brak sprawdzeń w tym okresie") {
  return h("p", { class: "chart-empty" }, text);
}

// ── line / area chart with a crosshair ─────────────────────────────────────
export interface LinePoint {
  /** Full label for the tooltip. */
  label: string;
  /** Axis tick text, or "" for no tick at this point. */
  tick: string;
  value: number;
  extra?: TipRow[];
  /** Drawn dashed: an incomplete period at the edge of the range. */
  partial?: boolean;
}
export function lineChart(host: HTMLElement, points: LinePoint[], seriesName: string) {
  const draw = () => {
    hideTip();
    if (!points.some((p) => p.value > 0)) return host.replaceChildren(empty());
    const W = Math.max(280, host.clientWidth);
    const H = W < 520 ? 200 : 260;
    const m = { l: 44, r: 12, t: 12, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const ticks = niceTicks(Math.max(...points.map((p) => p.value)));
    const top = ticks[ticks.length - 1];
    const x = (i: number) => m.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => m.t + ih - (v / top) * ih;

    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "line-chart", tabindex: 0, role: "img" });
    svg.setAttribute("aria-label", `${seriesName}: wykres liniowy, ${points.length} punktów. Strzałki przesuwają odczyt.`);
    for (const t of ticks) {
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }));
      const label = s("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" });
      label.textContent = fmt(t);
      svg.append(label);
    }
    points.forEach((p, i) => {
      if (!p.tick) return;
      const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
      const label = s("text", { x: x(i), y: H - 8, "text-anchor": anchor, class: "tick" });
      label.textContent = p.tick;
      svg.append(label);
    });
    const path = (from: number, to: number) =>
      points.slice(from, to + 1).map((p, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    const last = points.length - 1;
    svg.append(s("path", { d: `${path(0, last)}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`, class: "area" }));
    // Segments touching an incomplete period are dashed, so an edge dip is not read as a drop.
    const a = points[0]?.partial && last >= 3 ? 1 : 0;
    const b = points[last]?.partial && last >= 3 ? last - 1 : last;
    if (a) svg.append(s("path", { d: path(0, 1), class: "line is-partial" }));
    svg.append(s("path", { d: path(a, b), class: "line" }));
    if (b < last) svg.append(s("path", { d: path(last - 1, last), class: "line is-partial" }));
    const cross = s("line", { y1: m.t, y2: m.t + ih, class: "crosshair", visibility: "hidden" });
    const dot = s("circle", { r: 4.5, class: "dot", visibility: "hidden" });
    const hit = s("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" });
    svg.append(cross, dot, hit);

    let current = -1;
    const show = (i: number, cx?: number, cy?: number) => {
      current = Math.max(0, Math.min(points.length - 1, i));
      const p = points[current];
      for (const [el, vis] of [[cross, "visible"], [dot, "visible"]] as const) el.setAttribute("visibility", vis);
      cross.setAttribute("x1", String(x(current)));
      cross.setAttribute("x2", String(x(current)));
      dot.setAttribute("cx", String(x(current)));
      dot.setAttribute("cy", String(y(p.value)));
      const box = svg.getBoundingClientRect();
      showTip(cx ?? box.left + x(current), cy ?? box.top + y(p.value), p.partial ? `${p.label} · niepełny okres` : p.label, [
        { value: fmt(p.value), label: seriesName },
        ...(p.extra ?? []),
      ]);
    };
    const clear = () => {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      hideTip();
    };
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const rel = (e.clientX - box.left - m.l) / iw;
      show(Math.round(rel * (points.length - 1)), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", clear);
    svg.addEventListener("blur", clear);
    svg.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      show(current < 0 ? points.length - 1 : current + (e.key === "ArrowRight" ? 1 : -1));
    });
    host.replaceChildren(svg);
  };
  onResize(host, draw);
  draw();
}

// ── sparkline ──────────────────────────────────────────────────────────────
export function sparkline(values: number[], label: string): SVGSVGElement {
  const W = 72, H = 24;
  const max = Math.max(1, ...values);
  const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (W - 4);
  const y = (v: number) => H - 3 - (v / max) * (H - 6);
  const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img" });
  svg.setAttribute("aria-label", label);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  svg.append(s("path", { d, class: "spark-line" }), s("circle", { cx: x(last), cy: y(values[last]), r: 2.5, class: "spark-dot" }));
  return svg;
}

// ── weekday × hour heatmap ─────────────────────────────────────────────────
const DAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
const DAYS_FULL = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
export function heatmap(host: HTMLElement, grid: number[][]) {
  const max = Math.max(0, ...grid.flat());
  if (max === 0) return host.replaceChildren(empty());
  const wrap = h("div", { class: "heat", role: "img", "aria-label": "Mapa ciepła: liczba sprawdzeń według dnia tygodnia i godziny. Dokładne liczby w tabeli poniżej." });
  wrap.append(h("span", {}));
  for (let hr = 0; hr < 24; hr++) wrap.append(h("span", { class: "heat-hour" }, hr % 3 === 0 ? String(hr) : ""));
  grid.forEach((row, d) => {
    wrap.append(h("span", { class: "heat-day" }, DAYS[d]));
    row.forEach((v, hr) => {
      // Sequential: one hue (navy), light → dark; an empty hour stays the surface tint.
      const pct = v === 0 ? 0 : Math.round(12 + (v / max) * 88);
      const cell = h("span", { class: "heat-cell", style: v ? `--p:${pct}%` : undefined });
      cell.addEventListener("pointerenter", (e) =>
        showTip(e.clientX, e.clientY, `${DAYS_FULL[d]}, ${hr}:00–${hr + 1}:00`, [{ value: fmt(v), label: "sprawdzeń" }])
      );
      cell.addEventListener("pointerleave", hideTip);
      wrap.append(cell);
    });
  });
  const legend = h(
    "div",
    { class: "heat-legend", "aria-hidden": "true" },
    h("span", {}, "mniej"),
    h("span", { class: "heat-ramp" }),
    h("span", {}, "więcej"),
  );
  const table = dataTable(
    "Tabela danych",
    ["Dzień", ...Array.from({ length: 24 }, (_, i) => `${i}`)],
    grid.map((row, d) => [DAYS_FULL[d], ...row.map(fmt)]),
  );
  host.replaceChildren(wrap, legend, table);
}

// ── 100% segmented bar ─────────────────────────────────────────────────────
export interface Segment {
  key: string;
  label: string;
  value: number;
  /** CSS color of the fill. */
  color: string;
}
export function segmentedBar(parts: Segment[], name: string): HTMLElement {
  const total = parts.reduce((t, p) => t + p.value, 0);
  const share = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const bar = h("div", {
    class: "seg-bar",
    role: "img",
    "aria-label": `${name}: ${parts.filter((p) => p.value).map((p) => `${p.label} ${share(p.value)}%`).join(", ")}`,
  });
  for (const p of parts) {
    if (!p.value) continue;
    const pct = share(p.value);
    // A label goes inside only when it fits; otherwise the tooltip and the table carry it.
    const seg = h("span", { class: "seg", style: `flex-grow:${p.value};background:${p.color}` }, (p.value / total) >= .09 ? `${pct}%` : "");
    seg.addEventListener("pointerenter", (e) =>
      showTip(e.clientX, e.clientY, name, [{ value: `${pct}%`, label: `${p.label} · ${fmt(p.value)}`, key: p.color }])
    );
    seg.addEventListener("pointermove", (e) =>
      showTip(e.clientX, e.clientY, name, [{ value: `${pct}%`, label: `${p.label} · ${fmt(p.value)}`, key: p.color }])
    );
    seg.addEventListener("pointerleave", hideTip);
    bar.append(seg);
  }
  return bar;
}

export function legend(items: { label: string; color: string }[]): HTMLElement {
  return h(
    "ul",
    { class: "legend" },
    ...items.map((i) => h("li", {}, h("span", { class: "legend-swatch", style: `background:${i.color}` }), i.label)),
  );
}

/** Thin volume bar (8px, fully rounded) with the number beside it. */
export function volumeBar(value: number, max: number): HTMLElement {
  return h(
    "span",
    { class: "vol" },
    h("span", { class: "vol-track" }, h("span", { class: "vol-fill", style: `width:${max ? Math.max(2, (value / max) * 100) : 0}%` })),
    h("span", { class: "vol-num" }, fmt(value)),
  );
}

export function dataTable(summary: string, head: string[], rows: string[][]): HTMLElement {
  return h(
    "details",
    { class: "data-table" },
    h("summary", {}, summary),
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, ...head.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", {}, c)))))),
      ),
    ),
  );
}
