/**
 * NBP, no key: average exchange rates (table A), gold price, and the reference rate with its full
 * history (static XML files; they return 406 to "Accept: application/json", so plain fetch).
 * Verified live 2026-11-21. Code writes every number in the record.
 */
import { LIMITS } from "../config.ts";
import { formatNumber, indicatorByKey, parsePeriod } from "./stats-catalog.ts";
import { type ClaimQuery, type Connector, ConnectorError, fetchJson, fetchText, type SourceRecord } from "./types.ts";

const API = "https://api.nbp.pl/api";
const RATES_NOW = "https://static.nbp.pl/dane/stopy/stopy_procentowe.xml";
const RATES_ARCHIVE = "https://static.nbp.pl/dane/stopy/stopy_procentowe_archiwum.xml";

/** Plain-language currency names → ISO code, used only when extraction gave no code. */
const CURRENCY_WORDS: [RegExp, string][] = [
  [/\beur|euro/i, "EUR"],
  [/dolar|\busd\b/i, "USD"],
  [/frank|\bchf\b/i, "CHF"],
  [/funt|\bgbp\b/i, "GBP"],
  [/hrywn|\buah\b/i, "UAH"],
  [/jen\b|jena|\bjpy\b/i, "JPY"],
  [/korona czesk|\bczk\b/i, "CZK"],
];

interface Window {
  start: string;
  end: string;
  /** The single day the claim is about, if any. */
  day: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * 86_400_000));

function windowFor(time: string, today: string): Window | null {
  const p = parsePeriod(time);
  if (p.day) return { start: addDays(p.day, -7), end: p.day > today ? today : p.day, day: p.day };
  if (p.year && p.month) {
    const start = `${p.year}-${String(p.month).padStart(2, "0")}-01`;
    const end = iso(new Date(Date.UTC(p.year, p.month, 0)));
    return { start, end: end > today ? today : end, day: null };
  }
  if (p.year) return { start: `${p.year}-01-01`, end: `${p.year}-12-31` > today ? today : `${p.year}-12-31`, day: null };
  return null;
}

/** NBP limits one query to 93 days, so a year is fetched in parallel chunks. */
function chunks(w: Window): [string, string][] {
  const out: [string, string][] = [];
  for (let s = w.start; s <= w.end; s = addDays(s, 91)) {
    const e = addDays(s, 90);
    out.push([s, e < w.end ? e : w.end]);
  }
  return out;
}

async function fetchPoints<T>(paths: string[], ctx: { signal: AbortSignal }, pick: (j: T) => { period: string; value: number; note?: string }[]) {
  const settled = await Promise.all(paths.map(async (p) => {
    try {
      return pick(await fetchJson(`${API}${p}?format=json`, ctx.signal, LIMITS.connectorTimeoutMs) as T);
    } catch (err) {
      // 404 means "no quotes in this window" (weekend, holiday, future date), not a failure.
      if (err instanceof ConnectorError && err.kind === "not_found") return [];
      throw err;
    }
  }));
  return settled.flat().sort((a, b) => a.period.localeCompare(b.period));
}

function describe(points: { period: string; value: number }[], unit: string, w: Window | null, label: string): string[] {
  const lines: string[] = [];
  if (points.length <= 12) {
    lines.push(...points.map((p) => `${p.period}: ${formatNumber(p.value, unit)}`));
  } else {
    const vals = points.map((p) => p.value);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const lo = points.reduce((a, b) => (b.value < a.value ? b : a));
    const hi = points.reduce((a, b) => (b.value > a.value ? b : a));
    lines.push(
      `Okres: ${points[0].period} – ${points[points.length - 1].period} (${points.length} notowań)`,
      `Średnia z notowań w okresie: ${formatNumber(Number(mean.toFixed(4)), unit)}`,
      `Najniższa wartość: ${formatNumber(lo.value, unit)} (${lo.period})`,
      `Najwyższa wartość: ${formatNumber(hi.value, unit)} (${hi.period})`,
      `Pierwsze notowanie: ${points[0].period}: ${formatNumber(points[0].value, unit)}`,
      `Ostatnie notowanie: ${points[points.length - 1].period}: ${formatNumber(points[points.length - 1].value, unit)}`,
    );
  }
  if (w?.day) {
    const inForce = [...points].reverse().find((p) => p.period <= w.day!);
    if (inForce) lines.push(`${label} obowiązujący w dniu ${w.day}: ${formatNumber(inForce.value, unit)} (notowanie z ${inForce.period})`);
  }
  return lines;
}

function targetPeriods(points: { period: string }[], w: Window | null): string[] {
  if (!points.length) return [];
  if (!w) return [points[points.length - 1].period];
  if (w.day) {
    const inForce = [...points].reverse().find((p) => p.period <= w.day!);
    return inForce ? [inForce.period] : [];
  }
  return points.map((p) => p.period);
}

function currencyOf(claim: ClaimQuery): string | null {
  if (claim.currency && /^[A-Za-z]{3}$/.test(claim.currency)) return claim.currency.toUpperCase();
  return CURRENCY_WORDS.find(([re]) => re.test(claim.text))?.[1] ?? null;
}

/** Reference-rate history: archive XML (1998 → ) plus the current XML, as change points. */
export function parseReferenceRates(archiveXml: string, currentXml: string): { period: string; value: number }[] {
  const num = (s: string) => Number(s.replace(",", "."));
  const out = new Map<string, number>();
  for (const m of archiveXml.matchAll(/<pozycje\s+obowiazuje_od="([^"]+)"\s*>([\s\S]*?)<\/pozycje>/g)) {
    const ref = m[2].match(/id="ref"\s+oprocentowanie="([^"]+)"/);
    if (ref) out.set(m[1], num(ref[1]));
  }
  const cur = currentXml.match(/<pozycja\s+id="ref"[^>]*?oprocentowanie="([^"]+)"[^>]*?obowiazuje_od="([^"]+)"/);
  if (cur) out.set(cur[2], num(cur[1]));
  const sorted = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // Keep only actual changes of the reference rate (the archive also lists changes of other rates).
  return sorted.filter(([, v], i) => i === 0 || v !== sorted[i - 1][1]).map(([period, value]) => ({ period, value }));
}

export const nbp: Connector = {
  id: "nbp",
  label: "NBP (kursy walut, złoto, stopy procentowe)",
  required: true,
  appliesTo: (c) => Boolean(indicatorByKey(c.indicator)?.nbp),
  unavailableReason: () => null,

  async search(claim, ctx) {
    const ind = indicatorByKey(claim.indicator)!;
    const today = iso(new Date());
    const w = windowFor(claim.time, today);
    const retrieved_at = new Date().toISOString();
    const base = { retrieved_at, tier: "official" as const, origin_key: "nbp", publisher: "Narodowy Bank Polski" };

    if (ind.nbp === "reference_rate") {
      const [archive, current] = await Promise.all([
        fetchText(RATES_ARCHIVE, ctx.signal, LIMITS.connectorTimeoutMs),
        fetchText(RATES_NOW, ctx.signal, LIMITS.connectorTimeoutMs),
      ]);
      const all = parseReferenceRates(archive, current);
      if (!all.length) throw new ConnectorError("invalid_response", "no reference rates parsed");
      const p = parsePeriod(claim.time);
      const asOf = p.day ?? (p.year ? (p.month ? `${p.year}-${String(p.month).padStart(2, "0")}-28` : `${p.year}-12-31`) : today);
      const upTo = all.filter((r) => r.period <= asOf);
      const inForce = upTo[upTo.length - 1];
      const shown = all.filter((r) => r.period <= asOf).slice(-8);
      const latest = all[all.length - 1];
      // A year-only claim: every rate in force during that year (the one from 1 January plus changes).
      const atYearStart = p.year ? all.filter((r) => r.period <= `${p.year}-01-01`).pop() : undefined;
      const target = p.year && !p.day && !p.month
        ? [atYearStart, ...all.filter((r) => r.period.startsWith(String(p.year)))].filter((r) => r !== undefined).map((r) => r!.period)
        : inForce ? [inForce.period] : [];
      const lines = [
        "NBP: stopa referencyjna (decyzje Rady Polityki Pieniężnej)",
        "Zmiany stopy (obowiązuje od: wysokość):",
        ...shown.map((r) => `${r.period}: ${formatNumber(r.value, "%")}`),
        inForce ? `W dniu ${asOf} obowiązywała stopa referencyjna ${formatNumber(inForce.value, "%")} (od ${inForce.period}).` : `Brak danych o stopie przed ${asOf}.`,
        `Obecnie obowiązuje: ${formatNumber(latest.value, "%")} (od ${latest.period}).`,
      ];
      return [{
        ...base,
        source_id: `nbp:reference_rate:${asOf}`,
        route: "nbp",
        title: "Stopa referencyjna NBP",
        url: RATES_ARCHIVE,
        published_at: latest.period,
        text: lines.join("\n"),
        data: { indicator: ind.key, unit: "%", kind: "percent", points: all, target_periods: [...new Set(target)], exact: true },
      }];
    }

    if (ind.nbp === "gold_price") {
      const paths = w ? chunks(w).map(([s, e]) => `/cenyzlota/${s}/${e}/`) : ["/cenyzlota/last/5/"];
      const points = await fetchPoints<{ data: string; cena: number }[]>(paths, ctx, (j) => j.map((x) => ({ period: x.data, value: x.cena })));
      if (!points.length) return [];
      const lines = ["NBP: cena 1 g złota (próby 1000), w złotych", ...describe(points, "zł", w, "Cena")];
      return [record(base, ind.key, "gold", "Cena złota NBP", `${API}${paths[0]}?format=json`, points, w, lines, "zł")];
    }

    const cur = currencyOf(claim);
    if (!cur || cur === "PLN") return [];
    const paths = w
      ? chunks(w).map(([s, e]) => `/exchangerates/rates/a/${cur.toLowerCase()}/${s}/${e}/`)
      : [`/exchangerates/rates/a/${cur.toLowerCase()}/last/5/`];
    let name = cur;
    const points = await fetchPoints<{ currency: string; rates: { effectiveDate: string; mid: number; no: string }[] }>(
      paths,
      ctx,
      (j) => {
        name = j.currency ?? cur;
        return j.rates.map((r) => ({ period: r.effectiveDate, value: r.mid }));
      },
    );
    if (!points.length) return [];
    const lines = [`NBP: średni kurs ${cur} (${name}), tabela A, w złotych za 1 ${cur}`, ...describe(points, "zł", w, "Kurs")];
    return [record(base, ind.key, cur, `Średni kurs ${cur} (NBP, tabela A)`, `${API}${paths[0]}?format=json`, points, w, lines, "zł")];
  },
};

function record(
  base: { retrieved_at: string; tier: "official"; origin_key: string; publisher: string },
  indicator: string,
  key: string,
  title: string,
  url: string,
  points: { period: string; value: number }[],
  w: Window | null,
  lines: string[],
  unit: string,
): SourceRecord {
  return {
    ...base,
    source_id: `nbp:${key}:${points[0].period}:${points[points.length - 1].period}`,
    route: "nbp",
    title,
    url,
    published_at: points[points.length - 1].period,
    text: lines.join("\n"),
    data: { indicator, unit, kind: "number", points, target_periods: targetPeriods(points, w), exact: true },
  };
}
