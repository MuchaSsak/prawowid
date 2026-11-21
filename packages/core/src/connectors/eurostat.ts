/**
 * Eurostat dissemination API (JSON-stat 2.0), no key. Answers numeric claims about the indicators
 * in stats-catalog.ts: the series for the claim's country, the EU-27 value and the country's rank
 * among EU members for the claim's year. Code writes every number in the record; the model only
 * reads and quotes it. Verified live 2026-11-21 (architecture/api-endpoints-verified.md).
 */
import { LIMITS } from "../config.ts";
import {
  EU_MEMBERS,
  eurostatGeo,
  formatNumber,
  geoName,
  type Indicator,
  indicatorByKey,
  parsePeriod,
} from "./stats-catalog.ts";
import { type Connector, ConnectorError, fetchJson, type SourceRecord } from "./types.ts";

const BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/";

interface JsonStat {
  id: string[];
  size: number[];
  value: Record<string, number>;
  status?: Record<string, string>;
  updated?: string;
  dimension: Record<string, { category: { index: Record<string, number> } }>;
}

const FLAGS: Record<string, string> = {
  p: "dane tymczasowe",
  e: "szacunek",
  b: "zmiana metodologii",
  d: "inna definicja",
  u: "niska wiarygodność",
  f: "prognoza",
};

/** Decodes a JSON-stat cube into rows of {geo, time, value, flag}. */
export function decodeJsonStat(j: JsonStat): { geo: string; time: string; value: number; flag: string | null }[] {
  const codes = j.id.map((d) => {
    const inv: string[] = [];
    for (const [code, i] of Object.entries(j.dimension[d].category.index)) inv[i] = code;
    return inv;
  });
  const gi = j.id.indexOf("geo");
  const ti = j.id.indexOf("time");
  const rows = [];
  for (const [k, value] of Object.entries(j.value ?? {})) {
    let rest = Number(k);
    const coord: number[] = new Array(j.id.length);
    for (let d = j.id.length - 1; d >= 0; d--) {
      coord[d] = rest % j.size[d];
      rest = Math.floor(rest / j.size[d]);
    }
    rows.push({ geo: codes[gi][coord[gi]], time: codes[ti][coord[ti]], value, flag: j.status?.[k] ?? null });
  }
  return rows;
}

function url(ind: Indicator, params: Record<string, string>): string {
  const u = new URL(BASE + ind.eurostat!.dataset);
  u.searchParams.set("format", "JSON");
  u.searchParams.set("lang", "EN");
  for (const [k, v] of Object.entries({ ...ind.eurostat!.filters, ...params })) u.searchParams.set(k, v);
  return u.toString();
}

const isSemiannual = (ind: Indicator) => ind.key === "minimum_wage";

export const eurostat: Connector = {
  id: "eurostat",
  label: "Eurostat (statystyki UE)",
  required: true,
  appliesTo: (c) => Boolean(indicatorByKey(c.indicator)?.eurostat),
  unavailableReason: () => null,

  async search(claim, ctx) {
    const ind = indicatorByKey(claim.indicator)!;
    const geo = eurostatGeo(claim.geo);
    const { year } = parsePeriod(claim.time);
    const seriesParams: Record<string, string> = { geo };
    if (year && !isSemiannual(ind)) seriesParams.sinceTimePeriod = String(year - 4);
    else seriesParams.lastTimePeriod = isSemiannual(ind) ? "8" : "6";

    const cube = await fetchJson(url(ind, seriesParams), ctx.signal, LIMITS.connectorTimeoutMs) as JsonStat;
    if (!cube || typeof cube !== "object" || !Array.isArray(cube.id)) throw new ConnectorError("invalid_response", "not JSON-stat");
    const series = decodeJsonStat(cube).filter((r) => r.geo === geo).sort((a, b) => a.time.localeCompare(b.time));
    if (!series.length) return [];

    const available = series.map((r) => r.time);
    const yearPeriods = year ? available.filter((t) => t.startsWith(String(year))) : [];
    // Claim names a year we have → that year; no year → the latest value (assumed_period warning upstream).
    const target_periods = year ? yearPeriods : [available[available.length - 1]];
    const compareYear = (yearPeriods.length ? yearPeriods : [available[available.length - 1]])[0];

    const lines = [
      `Eurostat: ${ind.label_pl}`,
      `Obszar: ${geoName(geo)} (${geo})`,
      `Jednostka: ${ind.unit}`,
      `Definicja: ${ind.definition}`,
      "Wartości:",
      ...series.map((r) => `${r.time}: ${formatNumber(r.value, ind.unit)}${r.flag && FLAGS[r.flag] ? ` (${FLAGS[r.flag]})` : ""}`),
    ];
    if (year && !yearPeriods.length) {
      lines.push(`Brak danych za ${year} (najnowsze dane: ${available[available.length - 1]}).`);
    }

    // EU comparison for the same period: EU-27 value and rank among members (one extra call).
    try {
      const all = decodeJsonStat(
        await fetchJson(url(ind, { time: compareYear }), ctx.signal, LIMITS.connectorTimeoutMs) as JsonStat,
      );
      const eu = all.find((r) => r.geo === "EU27_2020");
      if (eu && geo !== "EU27_2020") lines.push(`Unia Europejska (27 państw) w ${compareYear}: ${formatNumber(eu.value, ind.unit)}`);
      const members = all.filter((r) => EU_MEMBERS.includes(r.geo)).sort((a, b) => a.value - b.value);
      const me = members.find((r) => r.geo === geo);
      if (members.length >= 10) {
        const lo = members[0];
        const hi = members[members.length - 1];
        lines.push(
          `Najniższa wartość w UE w ${compareYear}: ${geoName(lo.geo)}, ${formatNumber(lo.value, ind.unit)}; najwyższa: ${geoName(hi.geo)}, ${formatNumber(hi.value, ind.unit)}.`,
        );
        if (me) {
          const fromLow = 1 + members.filter((r) => r.value < me.value).length;
          const fromHigh = 1 + members.filter((r) => r.value > me.value).length;
          lines.push(
            `${geoName(geo)} w ${compareYear}: ${fromLow}. miejsce od najniższej i ${fromHigh}. od najwyższej wartości wśród ${members.length} państw UE z danymi.`,
          );
        }
      }
    } catch (err) {
      // The comparison is extra context; the series alone still answers the claim.
      if (!(err instanceof ConnectorError)) throw err;
    }

    const updated = cube.updated ? new Date(cube.updated).toISOString() : null;
    lines.push(`Zbiór danych Eurostatu: ${ind.eurostat!.dataset}.`);
    const record: SourceRecord = {
      source_id: `eurostat:${ind.eurostat!.dataset}:${ind.key}:${geo}`,
      route: "eurostat",
      title: `${ind.label_pl}: ${geoName(geo)}`,
      publisher: "Eurostat",
      url: `https://ec.europa.eu/eurostat/databrowser/view/${ind.eurostat!.dataset}/default/table?lang=en`,
      published_at: updated,
      retrieved_at: new Date().toISOString(),
      tier: "official",
      origin_key: "eurostat",
      text: lines.join("\n"),
      data: {
        indicator: ind.key,
        unit: ind.unit,
        kind: ind.kind,
        compare_abs: ind.compare_abs,
        points: series.map((r) => ({ period: r.time, value: r.value })),
        target_periods,
      },
    };
    return [record];
  },
};

