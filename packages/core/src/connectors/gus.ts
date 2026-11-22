/**
 * GUS Bank Danych Lokalnych (BDL), national level, no key. Optional route: the service is
 * sometimes unreachable (2026-11-21: TLS failures), and an outage must not block a claim that
 * Eurostat already answers. Only variable ids verified by hand are used (stats-catalog.ts).
 * When the live call fails, a saved copy (gus-snapshot.ts, scripts/snapshot_gus.ts) answers instead,
 * and the record says it is a copy and from which day.
 */
import { LIMITS } from "../config.ts";
import { formatNumber, indicatorByKey, parsePeriod } from "./stats-catalog.ts";
import { type Connector, ConnectorError, fetchJson } from "./types.ts";
import { GUS_SNAPSHOT } from "./gus-snapshot.ts";

interface BdlResponse {
  lastUpdate?: string;
  results?: { id: string; name: string; values: { year: string; val: number }[] }[];
}

export const gus: Connector = {
  id: "gus_bdl",
  label: "GUS (Bank Danych Lokalnych)",
  required: false,
  appliesTo: (c) => Boolean(indicatorByKey(c.indicator)?.gus_var) && (c.geo ?? "PL").toUpperCase() === "PL",
  unavailableReason: () => null,

  async search(claim, ctx) {
    const ind = indicatorByKey(claim.indicator)!;
    const url = `https://bdl.stat.gov.pl/api/v1/data/by-variable/${ind.gus_var}?unit-level=0&format=json&page-size=100`;
    let j: BdlResponse;
    let copyOf: string | null = null;
    try {
      j = await fetchJson(url, ctx.signal, LIMITS.connectorTimeoutMs) as BdlResponse;
    } catch (err) {
      const saved = GUS_SNAPSHOT[ind.gus_var!];
      if (!saved || ctx.signal.aborted) throw err;
      j = { lastUpdate: saved.last_update ?? undefined, results: [{ id: String(ind.gus_var), name: ind.label_pl, values: saved.values }] };
      copyOf = saved.retrieved_at;
    }
    const values = j.results?.[0]?.values;
    if (!Array.isArray(values)) throw new ConnectorError("invalid_response", "no BDL values");
    const points = values
      .filter((v) => typeof v.val === "number")
      .map((v) => ({ period: String(v.year), value: v.val }))
      .sort((a, b) => a.period.localeCompare(b.period))
      .slice(-6);
    if (!points.length) return [];
    const { year } = parsePeriod(claim.time);
    const target_periods = year ? points.filter((p) => p.period === String(year)).map((p) => p.period) : [points[points.length - 1].period];
    const lines = [
      `GUS, Bank Danych Lokalnych: ${ind.label_pl}, Polska`,
      ...(copyOf ? [`Kopia danych pobrana z API GUS ${copyOf.slice(0, 10)} (serwis GUS nie odpowiadał).`] : []),
      `Definicja: ${ind.definition}`,
      "Wartości (stan na 31 grudnia):",
      ...points.map((p) => `${p.period}: ${formatNumber(p.value, ind.unit)}`),
    ];
    return [{
      source_id: `gus:${ind.gus_var}`,
      route: "gus_bdl",
      title: `${ind.label_pl}: Polska (GUS)`,
      publisher: "Główny Urząd Statystyczny",
      url: `https://bdl.stat.gov.pl/api/v1/data/by-variable/${ind.gus_var}?unit-level=0&format=json`,
      published_at: j.lastUpdate ? new Date(j.lastUpdate).toISOString() : null,
      retrieved_at: copyOf ?? new Date().toISOString(),
      tier: "official",
      origin_key: "gus",
      text: lines.join("\n"),
      data: { indicator: ind.key, unit: ind.unit, kind: ind.kind, points, target_periods },
    }];
  },
};
