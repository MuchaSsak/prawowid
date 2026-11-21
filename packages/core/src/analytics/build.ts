/**
 * Admin analytics: one pure function turns check-log rows + events into the report the admin page
 * draws. Runs on the server (GET /api/v1/admin/analytics) and in the browser on synthetic rows
 * (sample.ts), so sample and real data go through the same code.
 *
 * Privacy (decision 011): only aggregates leave the store, plus the masked text of the most repeated
 * claims. No session ids, no raw input, no per-person view. Times are bucketed in Europe/Warsaw.
 */
import { normalizeForMatch } from "../guard/normalize.ts";
import { CLAIM_TYPES, type ClaimType, type Verdict, VERDICTS } from "../types.ts";

export const ANALYTICS_RANGES = ["24h", "7d", "30d", "90d", "1y"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export type AnalyticsBucket = "hour" | "day" | "week" | "month";
export type TopicKey = ClaimType | "other";

/** Structural subset of CheckLogRow, so store rows and synthetic rows both fit. */
export interface AnalyticsCheck {
  created_at: string;
  channel: string;
  status: string;
  latency_ms: number;
  cost_usd: number;
  claims: {
    verdict: string | null;
    system_state: string | null;
    text?: string;
    type?: ClaimType | null;
    class?: "fact" | "opinion" | "prediction";
    context_match?: boolean;
  }[];
  /** Synthetic rows only: how many real checks this row stands for (keeps long sample ranges light). */
  weight?: number;
}
export interface AnalyticsEvent {
  type: string;
  created_at: string;
}

export interface Kpi {
  value: number;
  prev: number;
}
export interface AnalyticsReport {
  range: AnalyticsRange;
  bucket: AnalyticsBucket;
  timezone: "Europe/Warsaw";
  generated_at: string;
  from: string;
  sample: boolean;
  /** Oldest row the store still holds (real data is cut by the 30-day retention). */
  oldest_row: string | null;
  /**
   * `false_share`: share (0..1) of rated facts that came out `false` or `misleading`; the base is
   * every claim with a truth verdict (not `not_verifiable`, not a system state).
   */
  kpis: { checks: Kpi; claims: Kpi; false_share: Kpi; median_latency_ms: Kpi; cost_per_100_usd: Kpi };
  /** `partial`: the bucket is cut by the range edge (first) or still running (last); not a real dip. */
  volume: { key: string; label: string; checks: number; claims: number; partial?: boolean }[];
  /** [weekday Mon..Sun][hour 0..23] → checks. */
  heatmap: number[][];
  topics: {
    topic: TopicKey;
    label: string;
    claims: number;
    prev: number;
    /** (claims - prev) / prev; null when the previous period had none. */
    growth: number | null;
    /** 12 equal slices of the range. */
    spark: number[];
    verdicts: Record<Verdict, number>;
    system_states: number;
  }[];
  /** Most checked claims (masked text), with the same trend fields as `topics`. */
  top_claims: {
    text: string;
    count: number;
    prev: number;
    growth: number | null;
    spark: number[];
    topic: TopicKey;
    label: string;
    verdict: Verdict | null;
    last_at: string;
  }[];
  integrity: {
    injection_detected: number;
    pii_redacted: number;
    context_matches: number;
    system_states: number;
    opinions: number;
    abstained: number;
  };
  channels: { channel: string; checks: number }[];
}

export const TOPIC_LABEL: Record<TopicKey, string> = {
  numeric: "Liczby i statystyki",
  legal: "Prawo i przepisy",
  parliamentary: "Sejm i głosowania",
  official_statement: "Komunikaty urzędów",
  event: "Wydarzenia",
  narrative: "Narracje",
  other: "Opinie i bez kategorii",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPAN: Record<AnalyticsRange, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };
const BUCKET: Record<AnalyticsRange, AnalyticsBucket> = { "24h": "hour", "7d": "hour", "30d": "day", "90d": "week", "1y": "month" };
const STEP: Record<AnalyticsBucket, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 28 * DAY };

const TZ = "Europe/Warsaw";
let partsFmt: Intl.DateTimeFormat | null = null;
interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  /** 0 = Monday. */
  wd: number;
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function warsawParts(ms: number): LocalParts {
  return local(ms);
}
function local(ms: number): LocalParts {
  partsFmt ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(ms)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, wd: WEEKDAYS.indexOf(p.weekday) };
}
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

function bucketOf(ms: number, bucket: AnalyticsBucket): { key: string; label: string } {
  const p = local(ms);
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  if (bucket === "hour") return { key: `${date}T${pad(p.h)}`, label: `${p.d} ${MONTHS[p.m - 1]} ${pad(p.h)}:00` };
  if (bucket === "day") return { key: date, label: `${p.d} ${MONTHS[p.m - 1]}` };
  if (bucket === "month") return { key: `${p.y}-${pad(p.m)}`, label: `${MONTHS[p.m - 1]} ${p.y}` };
  // Week: the local Monday of that week (noon avoids DST edges).
  const monday = local(Date.UTC(p.y, p.m - 1, p.d, 12) - p.wd * DAY);
  return { key: `W${monday.y}-${pad(monday.m)}-${pad(monday.d)}`, label: `od ${monday.d} ${MONTHS[monday.m - 1]}` };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const emptyVerdicts = (): Record<Verdict, number> =>
  Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
const isVerdict = (v: string | null): v is Verdict => v !== null && (VERDICTS as readonly string[]).includes(v);
const topicOf = (t: ClaimType | null | undefined): TopicKey => (t && (CLAIM_TYPES as readonly string[]).includes(t) ? t : "other");

export function buildAnalytics(
  checks: AnalyticsCheck[],
  events: AnalyticsEvent[],
  opts: { range: AnalyticsRange; now?: Date; sample?: boolean },
): AnalyticsReport {
  const now = (opts.now ?? new Date()).getTime();
  const span = SPAN[opts.range];
  const bucket = BUCKET[opts.range];
  const from = now - span;
  const prevFrom = from - span;
  const t = (r: { created_at: string }) => Date.parse(r.created_at);
  const w = (c: AnalyticsCheck) => c.weight ?? 1;

  const cur = checks.filter((c) => t(c) > from && t(c) <= now);
  const prev = checks.filter((c) => t(c) > prevFrom && t(c) <= from);

  // Buckets, oldest first; every bucket is present even when empty.
  const volume: AnalyticsReport["volume"] = [];
  const index = new Map<string, number>();
  // Half-step walk from just after `from` to `now` inclusive: the first and last buckets may be partial.
  const halfStep = bucket === "month" ? 14 * DAY : STEP[bucket] / 2;
  for (let ms = from + 1;; ms += halfStep) {
    const x = Math.min(ms, now);
    const b = bucketOf(x, bucket);
    if (!index.has(b.key)) {
      index.set(b.key, volume.length);
      volume.push({ ...b, checks: 0, claims: 0 });
    }
    if (x === now) break;
  }
  if (volume.length > 2) volume[0].partial = volume[volume.length - 1].partial = true;

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const topics = new Map<TopicKey, AnalyticsReport["topics"][number]>();
  for (const k of [...CLAIM_TYPES, "other"] as TopicKey[]) {
    topics.set(k, { topic: k, label: TOPIC_LABEL[k], claims: 0, prev: 0, growth: null, spark: Array(12).fill(0), verdicts: emptyVerdicts(), system_states: 0 });
  }
  const repeated = new Map<
    string,
    { text: string; count: number; prev: number; spark: number[]; topics: Map<TopicKey, number>; verdicts: Map<Verdict, number>; last: number }
  >();
  const claimKey = (text: string) => normalizeForMatch(text).toLowerCase().replace(/[.!?]+$/, "");
  const integrity = { injection_detected: 0, pii_redacted: 0, context_matches: 0, system_states: 0, opinions: 0, abstained: 0 };
  const channels = new Map<string, number>();

  let claimCount = 0;
  for (const c of cur) {
    const ms = t(c);
    const weight = w(c);
    const p = local(ms);
    heatmap[p.wd][p.h] += weight;
    const i = index.get(bucketOf(ms, bucket).key);
    if (i !== undefined) {
      volume[i].checks += weight;
      volume[i].claims += c.claims.length * weight;
    }
    channels.set(c.channel, (channels.get(c.channel) ?? 0) + weight);
    const slice = Math.min(11, Math.floor(((ms - from) / span) * 12));
    for (const cl of c.claims) {
      claimCount += weight;
      const tp = topics.get(topicOf(cl.type))!;
      tp.claims += weight;
      tp.spark[slice] += weight;
      if (isVerdict(cl.verdict)) tp.verdicts[cl.verdict] += weight;
      else tp.system_states += weight;
      if (cl.system_state) integrity.system_states += weight;
      if (cl.class === "opinion" || cl.class === "prediction") integrity.opinions += weight;
      if (cl.verdict === "insufficient_evidence") integrity.abstained += weight;
      if (cl.context_match) integrity.context_matches += weight;
      if (cl.text && cl.class === "fact") {
        const key = claimKey(cl.text);
        const r = repeated.get(key) ?? { text: cl.text, count: 0, prev: 0, spark: Array(12).fill(0), topics: new Map(), verdicts: new Map(), last: 0 };
        r.count += weight;
        r.spark[slice] += weight;
        r.topics.set(topicOf(cl.type), (r.topics.get(topicOf(cl.type)) ?? 0) + 1);
        if (isVerdict(cl.verdict)) r.verdicts.set(cl.verdict, (r.verdicts.get(cl.verdict) ?? 0) + 1);
        if (ms >= r.last) [r.last, r.text] = [ms, cl.text];
        repeated.set(key, r);
      }
    }
  }
  for (const c of prev) {
    for (const cl of c.claims) {
      topics.get(topicOf(cl.type))!.prev += w(c);
      const r = cl.text && cl.class === "fact" ? repeated.get(claimKey(cl.text)) : undefined;
      if (r) r.prev += w(c);
    }
  }
  for (const tp of topics.values()) tp.growth = tp.prev > 0 ? (tp.claims - tp.prev) / tp.prev : null;

  for (const e of events) {
    const ms = t(e);
    if (ms <= from || ms > now) continue;
    if (e.type === "injection_detected") integrity.injection_detected++;
    if (e.type === "pii_redacted") integrity.pii_redacted++;
  }

  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sumW = (xs: AnalyticsCheck[]) => xs.reduce((s, c) => s + w(c), 0);
  const claimsW = (xs: AnalyticsCheck[]) => xs.reduce((s, c) => s + c.claims.length * w(c), 0);
  const falseShare = (xs: AnalyticsCheck[]) => {
    let rated = 0, bad = 0;
    for (const c of xs) {
      for (const cl of c.claims) {
        if (!isVerdict(cl.verdict) || cl.verdict === "not_verifiable") continue;
        rated += w(c);
        if (cl.verdict === "false" || cl.verdict === "misleading") bad += w(c);
      }
    }
    return rated ? bad / rated : 0;
  };
  const answered = (xs: AnalyticsCheck[]) => xs.filter((c) => c.latency_ms > 0 && (c.status === "ok" || c.status === "partial"));
  const costPer100 = (xs: AnalyticsCheck[]) => (xs.length ? (xs.reduce((s, c) => s + c.cost_usd, 0) / xs.length) * 100 : 0);
  const oldest = checks.reduce<number | null>((m, c) => (m === null || t(c) < m ? t(c) : m), null);

  return {
    range: opts.range,
    bucket,
    timezone: TZ,
    generated_at: new Date(now).toISOString(),
    from: new Date(from).toISOString(),
    sample: opts.sample ?? false,
    oldest_row: oldest === null ? null : new Date(oldest).toISOString(),
    kpis: {
      checks: { value: sumW(cur), prev: sumW(prev) },
      claims: { value: claimCount, prev: claimsW(prev) },
      false_share: { value: falseShare(cur), prev: falseShare(prev) },
      median_latency_ms: { value: median(answered(cur).map((c) => c.latency_ms)), prev: median(answered(prev).map((c) => c.latency_ms)) },
      cost_per_100_usd: { value: costPer100(cur), prev: costPer100(prev) },
    },
    volume,
    heatmap,
    topics: [...topics.values()].filter((x) => x.claims > 0 || x.prev > 0).sort((a, b) => b.claims - a.claims),
    top_claims: [...repeated.values()]
      // Privacy (decision 011): a claim seen once could identify one person's query; only repeats leave.
      .filter((r) => r.count > 1)
      .sort((a, b) => b.count - a.count || b.last - a.last)
      .slice(0, 8)
      .map((r) => {
        const topic = (top(r.topics as Map<string, number>) ?? "other") as TopicKey;
        return {
          text: r.text,
          count: r.count,
          prev: r.prev,
          growth: r.prev > 0 ? (r.count - r.prev) / r.prev : null,
          spark: r.spark,
          topic,
          label: TOPIC_LABEL[topic],
          verdict: (top(r.verdicts as Map<string, number>) ?? null) as Verdict | null,
          last_at: new Date(r.last).toISOString(),
        };
      }),
    integrity,
    channels: [...channels.entries()].map(([channel, n]) => ({ channel, checks: n })).sort((a, b) => b.checks - a.checks),
  };
}
