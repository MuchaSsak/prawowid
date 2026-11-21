/**
 * Synthetic check logs for the admin page's "Dane przykładowe" switch. Clearly fake: invented claims,
 * no real users. Deterministic per hour (seeded from `now`), so a reload shows the same picture.
 * Patterns built in so the charts have something to show: a daily rhythm (morning, lunch and evening
 * peaks), quieter weekends, slow user growth, a viral event in the last day and a rising narrative.
 */
import type { ClaimType, Verdict } from "../types.ts";
import { type AnalyticsCheck, type AnalyticsEvent, type AnalyticsRange, buildAnalytics, type AnalyticsReport, warsawParts } from "./build.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPAN: Record<AnalyticsRange, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };
/** Long ranges generate fewer rows that each stand for several checks. */
const WEIGHT: Record<AnalyticsRange, number> = { "24h": 1, "7d": 1, "30d": 1, "90d": 4, "1y": 12 };

// Checks per hour at the peak, by local hour.
const HOUR_PROFILE = [
  .12, .07, .05, .04, .05, .1, .25, .55, .85, .8, .7, .75, .9, .8, .65, .6, .62, .7, .82, .95, 1, .9, .6, .3,
];
const WEEKDAY = [1, 1.02, .98, 1, .92, .7, .75]; // Mon..Sun
const PEAK_PER_HOUR = 14;

type Topic = ClaimType | "opinion";
const TOPIC_WEIGHT: Record<Topic, number> = {
  numeric: .24, legal: .17, event: .16, narrative: .14, official_statement: .1, parliamentary: .08, opinion: .11,
};
// Shares of each verdict per topic, plus "state" = a system state (source unavailable etc.).
type Outcome = Verdict | "state";
const PROFILE: Record<Topic, [Outcome, number][]> = {
  numeric: [["confirmed", .38], ["false", .2], ["misleading", .18], ["insufficient_evidence", .2], ["state", .04]],
  legal: [["confirmed", .4], ["false", .21], ["misleading", .12], ["insufficient_evidence", .24], ["state", .03]],
  parliamentary: [["confirmed", .3], ["false", .2], ["misleading", .14], ["insufficient_evidence", .32], ["state", .04]],
  official_statement: [["confirmed", .34], ["false", .16], ["misleading", .1], ["insufficient_evidence", .37], ["state", .03]],
  event: [["confirmed", .2], ["false", .31], ["misleading", .16], ["insufficient_evidence", .31], ["state", .02]],
  narrative: [["confirmed", .06], ["false", .38], ["misleading", .28], ["insufficient_evidence", .27], ["state", .01]],
  opinion: [["not_verifiable", 1]],
};
// Invented example claims (synthetic; no real people).
const CLAIMS: Record<Topic, string[]> = {
  numeric: [
    "Inflacja w Polsce w październiku przekroczyła 5%",
    "Bezrobocie w Polsce jest najniższe w Unii Europejskiej",
    "Kurs euro przekroczył 4,60 zł",
    "Polska wydaje na obronność ponad 4% PKB",
    "Liczba ludności Polski spadła poniżej 37 mln",
  ],
  legal: [
    "Od stycznia płatności gotówką powyżej 10 tys. zł będą zakazane",
    "Nowa ustawa pozwala policji przeglądać telefony bez nakazu sądu",
    "Prawo jazdy trzeba będzie odnawiać co 5 lat",
    "Ustawa o ochronie ludności pozwala zabierać prywatne samochody",
  ],
  parliamentary: [
    "Sejm odrzucił projekt podwyżki płacy minimalnej",
    "Posłowie w nocy przegłosowali sobie podwyżki",
    "Ustawę przyjęto bez głosowania w komisji",
  ],
  official_statement: [
    "MSZ odradza wszystkie podróże do Włoch",
    "RCB wysłało alert o skażeniu wody w Warszawie",
    "Rząd ogłosił stan wyjątkowy przy granicy",
  ],
  event: [
    "We Włoszech trwa strajk generalny i lotniska są zamknięte",
    "W Gdańsku zamknięto port po ataku hakerów",
    "Na granicy z Białorusią doszło do strzelaniny",
  ],
  narrative: [
    "Ukraińcy dostają wyższe świadczenia niż Polacy",
    "UE zakaże sprzedaży mięsa od 2030 roku",
    "Szczepionki zawierają chipy śledzące",
  ],
  opinion: ["Rząd kłamie w sprawie inflacji", "Ta ustawa to katastrofa dla kraju"],
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1][0];
}

function poisson(r: () => number, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l && k < 200);
  return k - 1;
}

export function sampleLogs(range: AnalyticsRange, now = new Date()): { checks: AnalyticsCheck[]; events: AnalyticsEvent[] } {
  const end = now.getTime();
  const span = SPAN[range];
  const weight = WEIGHT[range];
  const start = end - 2 * span; // current + previous period
  const r = rng(Math.floor(end / HOUR));
  const checks: AnalyticsCheck[] = [];
  const events: AnalyticsEvent[] = [];
  const twoYears = 730 * DAY;

  for (let hour = Math.floor(start / HOUR) * HOUR; hour < end; hour += HOUR) {
    const p = warsawParts(hour);
    const growth = .45 + .55 * Math.min(1, Math.max(0, (hour - (end - twoYears)) / twoYears));
    const viral = end - hour < 30 * HOUR; // the last ~day: a viral event
    const lambda = PEAK_PER_HOUR * HOUR_PROFILE[p.h] * WEEKDAY[p.wd] * growth * (viral ? 1.5 : 1);
    const n = poisson(r, lambda / weight);
    for (let i = 0; i < n; i++) {
      const at = hour + Math.floor(r() * HOUR);
      if (at > end) continue;
      const narrativeRise = 1 + Math.max(0, 1 - (end - at) / (10 * DAY)) * 1.4;
      const topicWeights = (Object.entries(TOPIC_WEIGHT) as [Topic, number][]).map(([t, w]): [Topic, number] => [
        t,
        w * (t === "event" && viral ? 5 : 1) * (t === "narrative" ? narrativeRise : 1),
      ]);
      const claimCount = pick(r, [[1, .55], [2, .3], [3, .15]] as [number, number][]);
      const claims: AnalyticsCheck["claims"] = [];
      for (let c = 0; c < claimCount; c++) {
        const topic = pick(r, topicWeights);
        const pool = CLAIMS[topic];
        // Viral spike: one claim dominates the event topic.
        const text = topic === "event" && viral && r() < .8 ? pool[0] : pool[Math.min(pool.length - 1, Math.floor(-Math.log(1 - r() * .95) * 1.2))];
        const outcome = pick(r, PROFILE[topic]);
        claims.push({
          text,
          type: topic === "opinion" ? null : topic,
          class: topic === "opinion" ? "opinion" : "fact",
          verdict: outcome === "state" ? null : outcome,
          system_state: outcome === "state" ? "source_unavailable" : null,
          context_match: topic === "narrative" ? r() < .4 : topic === "event" ? r() < .1 : r() < .02,
        });
      }
      const created_at = new Date(at).toISOString();
      checks.push({
        created_at,
        channel: pick(r, [["web", .7], ["discord", .18], ["whatsapp", .12]] as [string, number][]),
        status: claims.some((c) => c.system_state) ? "partial" : "ok",
        latency_ms: Math.round(3800 + r() * 3200 + (r() < .1 ? r() * 6000 : 0)),
        cost_usd: Number((.0006 + r() * .0005 * claimCount).toFixed(6)),
        claims,
        weight,
      });
      for (let k = 0; k < weight; k++) {
        if (r() < .012) events.push({ type: "injection_detected", created_at });
        if (r() < .04) events.push({ type: "pii_redacted", created_at });
      }
    }
  }
  return { checks, events };
}

export function sampleAnalytics(range: AnalyticsRange, now = new Date()): AnalyticsReport {
  const { checks, events } = sampleLogs(range, now);
  return buildAnalytics(checks, events, { range, now, sample: true });
}
