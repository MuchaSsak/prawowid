/**
 * In-memory rate limiting for the API (per instance; resets on redeploy or cold start).
 *
 * The goal: a person (or a tester clicking fast through demo scenarios) should practically never
 * see a limit, while a script that hammers the API gets stopped and then shut out.
 *
 *   burst    token bucket: a few quick requests are fine, then a steady pace (a live check takes
 *            5-10 s anyway, so a human in the web app never empties it)
 *   windows  hourly and daily ceilings, far above what a person does by hand
 *   abuse    a client that keeps sending after being told to wait (bots do, people don't) is
 *            banned, and each repeat ban doubles, up to a day
 *
 * Runtime-agnostic and clock-injectable so it can be tested without waiting.
 */

export interface Policy {
  /** Token bucket: `capacity` requests at once, then one more every `refillMs`. */
  burst?: { capacity: number; refillMs: number };
  /** Fixed windows, e.g. per hour and per day. */
  windows?: { limit: number; windowMs: number }[];
  /** `strikes` refused requests within `windowMs` → ban for `banMs`, doubling per repeat up to `maxBanMs`. */
  abuse?: { strikes: number; windowMs: number; banMs: number; maxBanMs: number };
}

export type Decision =
  | { ok: true }
  | { ok: false; retryAfterMs: number; reason: "burst" | "window" | "banned" };

interface Entry {
  tokens: number;
  refilledAt: number;
  windows: { start: number; n: number }[];
  strikes: number;
  strikeStart: number;
  bannedUntil: number;
  bans: number;
  seenAt: number;
}

export class RateLimiter {
  readonly #entries = new Map<string, Entry>();
  readonly #policy: Policy;
  readonly #now: () => number;
  /** Idle entries older than this are dropped by sweep(). */
  readonly #keepMs: number;

  constructor(policy: Policy, now: () => number = Date.now) {
    this.#policy = policy;
    this.#now = now;
    this.#keepMs = Math.max(
      60_000,
      ...(policy.windows ?? []).map((w) => w.windowMs),
      policy.abuse?.windowMs ?? 0,
    );
  }

  /** Counts one request for `key` if allowed; a refused request counts as a strike instead. */
  hit(key: string): Decision {
    const t = this.#now();
    const e = this.#entry(key, t);
    const refused = this.#refusal(e, t);
    if (refused) {
      if (refused.reason !== "banned") this.#strike(e, t);
      // A strike may have just turned into a ban: report the longer wait.
      return e.bannedUntil > t ? { ok: false, reason: "banned", retryAfterMs: e.bannedUntil - t } : refused;
    }
    if (this.#policy.burst) e.tokens -= 1;
    for (const w of e.windows) w.n++;
    return { ok: true };
  }

  /** Like hit() but does not count anything: is `key` currently refused? */
  check(key: string): Decision {
    const t = this.#now();
    return this.#refusal(this.#entry(key, t), t) ?? { ok: true };
  }

  /** Drops entries idle for longer than the longest window (call periodically to bound memory). */
  sweep(): void {
    const t = this.#now();
    for (const [k, e] of this.#entries) {
      if (t - e.seenAt > this.#keepMs && e.bannedUntil <= t) this.#entries.delete(k);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  #entry(key: string, t: number): Entry {
    let e = this.#entries.get(key);
    if (!e) {
      e = {
        tokens: this.#policy.burst?.capacity ?? 0,
        refilledAt: t,
        windows: (this.#policy.windows ?? []).map(() => ({ start: t, n: 0 })),
        strikes: 0,
        strikeStart: t,
        bannedUntil: 0,
        bans: 0,
        seenAt: t,
      };
      this.#entries.set(key, e);
    }
    e.seenAt = t;
    const b = this.#policy.burst;
    if (b) {
      e.tokens = Math.min(b.capacity, e.tokens + (t - e.refilledAt) / b.refillMs);
      e.refilledAt = t;
    }
    (this.#policy.windows ?? []).forEach((w, i) => {
      if (t - e.windows[i].start >= w.windowMs) e.windows[i] = { start: t, n: 0 };
    });
    return e;
  }

  #refusal(e: Entry, t: number): Exclude<Decision, { ok: true }> | null {
    if (e.bannedUntil > t) return { ok: false, reason: "banned", retryAfterMs: e.bannedUntil - t };
    let wait = 0;
    let reason: "burst" | "window" = "burst";
    const b = this.#policy.burst;
    if (b && e.tokens < 1) wait = Math.ceil((1 - e.tokens) * b.refillMs);
    (this.#policy.windows ?? []).forEach((w, i) => {
      const s = e.windows[i];
      if (s.n >= w.limit && s.start + w.windowMs - t > wait) {
        wait = s.start + w.windowMs - t;
        reason = "window";
      }
    });
    return wait > 0 ? { ok: false, reason, retryAfterMs: wait } : null;
  }

  #strike(e: Entry, t: number): void {
    const a = this.#policy.abuse;
    if (!a) return;
    if (t - e.strikeStart >= a.windowMs) {
      e.strikeStart = t;
      e.strikes = 0;
    }
    if (++e.strikes < a.strikes) return;
    e.bannedUntil = t + Math.min(a.banMs * 2 ** e.bans, a.maxBanMs);
    e.bans++;
    e.strikes = 0;
  }
}

/**
 * The rate-limit key for an IP. IPv6 is grouped by its /64 prefix, because one host usually holds
 * a whole /64 and a script can rotate through it for free.
 */
export function ipKey(ip: string): string {
  const addr = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (!addr.includes(":")) return `ip:${addr}`;
  const v4Mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) return `ip:${v4Mapped[1]}`;
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const tl = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill("0"), ...tl];
  return `ip6:${groups.slice(0, 4).map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** "45 s", "3 min", "2 godz." for the user-facing message. */
export function waitText(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.ceil(m / 60)} godz.`;
}
