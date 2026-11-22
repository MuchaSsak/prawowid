/**
 * Fetch a public article for checking. Isolated from the model: the model never sees or chooses
 * URLs. Guards (verification-pipeline §1): public http(s) only, every redirect revalidated, at most
 * 3 redirects, byte and time caps, tracking params stripped, private params refused, robots.txt
 * respected (hard constraint 13). DNS-level checks are injected by the host runtime (`resolveHost`).
 */
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { LIMITS, USER_AGENT } from "../config.ts";

export class IntakeError extends Error {
  constructor(
    public kind: "invalid_url" | "blocked" | "robots" | "fetch_failed" | "timeout" | "unsupported" | "too_large" | "empty",
    message: string,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}

export interface Article {
  url: string;
  title: string | null;
  site_name: string | null;
  published_at: string | null;
  text: string;
  truncated: boolean;
}

/** Returns the IPs a hostname resolves to (host-provided; core stays runtime-agnostic). */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|ref_src|si|spm)$/i;
/** Private-looking words, matched against whole parameter-name parts (`access_token`, `userEmail`,
 * `PHPSESSID`), never substrings, so `author`, `keyword`, `postcode`, `president` pass. */
const PRIVATE_PARAM =
  /^(token|key|apikey|apitoken|authkey|accesskey|passkey|privatekey|sesskey|sessiontoken|pass|passwd|password|pwd|secret|session|sessionid|sessid|phpsessid|jsessionid|sid|auth|authtoken|accesstoken|sig|signature|email|phone|code)$/;

export function isPrivateParam(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/);
  return PRIVATE_PARAM.test(name.toLowerCase()) || parts.some((p) => PRIVATE_PARAM.test(p));
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("::ffff:");
}

/** Validates and cleans a user URL. Throws IntakeError with a user-explainable reason. */
export function cleanUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IntakeError("invalid_url", "To nie jest poprawny adres URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new IntakeError("invalid_url", "Obsługujemy tylko adresy http(s).");
  }
  if (url.username || url.password) throw new IntakeError("blocked", "Adres zawiera dane logowania.");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new IntakeError("blocked", "Adres używa niestandardowego portu.");
  }
  const host = url.hostname.toLowerCase();
  if (
    !host.includes(".") || host === "localhost" || /\.(local|localhost|internal|lan|home|arpa)$/.test(host) ||
    host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new IntakeError("blocked", "Sprawdzamy tylko publiczne strony internetowe (bez adresów IP i sieci lokalnych).");
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
    else if (isPrivateParam(key)) {
      throw new IntakeError(
        "blocked",
        "Link zawiera parametry, które mogą być prywatne. Wklej link bez nich albo wklej sam tekst.",
      );
    }
  }
  url.hash = "";
  return url;
}

async function assertPublic(url: URL, resolveHost?: ResolveHost) {
  if (!resolveHost) return;
  let ips: string[];
  try {
    ips = await resolveHost(url.hostname);
  } catch {
    throw new IntakeError("fetch_failed", "Nie udało się odnaleźć tej strony (DNS).");
  }
  if (ips.length === 0 || ips.some(isPrivateIp)) {
    throw new IntakeError("blocked", "Ten adres prowadzi do sieci prywatnej. Nie pobieramy takich stron.");
  }
}

// ── robots.txt (per-host cache) ───────────────────────────────────────────────
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
const robotsCache = new Map<string, { groups: RobotsRule[][]; at: number }>();

/**
 * User agents of AI crawlers and AI fetchers. We feed an AI fact-checking system, so a site that
 * blocks them blocks us too, also for a single link a user pastes (decision 012, user 2026-11-22).
 */
const AI_AGENTS = [
  "gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-user", "claude-searchbot", "claude-web",
  "anthropic-ai", "ccbot", "google-extended", "perplexitybot", "perplexity-user", "bytespider", "cohere-ai",
  "meta-externalagent", "meta-externalfetcher", "applebot-extended", "amazonbot", "diffbot", "youbot",
  "mistralai-user", "ai2bot", "duckassistbot", "timpibot", "imagesiftbot", "omgili",
];

function agentApplies(agent: string): boolean {
  return agent === "*" || agent.includes("prawdowid") || AI_AGENTS.some((a) => agent.includes(a));
}

/**
 * The rules of every group that applies to us ("*", our bot, any AI crawler), one list per group.
 * A path is allowed only if every group allows it: merging them would let "Allow: /" for "*" win a
 * tie against "Disallow: /" for GPTBot.
 */
export function parseRobotsGroups(txt: string): RobotsRule[][] {
  const lines = txt.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const groups: { rules: RobotsRule[]; agents: string[] }[] = [];
  let current: { rules: RobotsRule[]; agents: string[] } | null = null;
  let applies = false;
  let lastWasAgent = false;
  for (const line of lines) {
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      const match = agentApplies(agent);
      if (!lastWasAgent) {
        current = { rules: [], agents: [] };
        applies = false;
      }
      current!.agents.push(agent);
      if (match && !applies) groups.push(current!);
      applies = applies || match;
      lastWasAgent = true;
      continue;
    }
    // Only rules end a run of User-agent lines (RFC 9309 §2.2.4); Sitemap and other records don't.
    if (key !== "disallow" && key !== "allow") continue;
    lastWasAgent = false;
    if (applies && current && value) current.rules.push({ allow: key === "allow", pattern: canonicalPath(value) });
  }
  // A group naming our bot replaces "*" for us (RFC 9309); AI-crawler groups still apply.
  const ours = groups.some((g) => g.agents.some((a) => a.includes("prawdowid")));
  return groups.filter((g) => !ours || !g.agents.every((a) => a === "*")).map((g) => g.rules);
}

/**
 * One form for paths and rules before comparing: raw non-ASCII percent-encoded, percent escapes in
 * upper case, escapes of unreserved characters decoded (RFC 9309 §2.2.2); reserved escapes stay.
 */
function canonicalPath(s: string): string {
  return s
    .replace(/[^\x00-\x7f]+/g, (c) => encodeURIComponent(c))
    .replace(/%([0-9a-fA-F]{2})/g, (_, h: string) => {
      const ch = String.fromCharCode(parseInt(h, 16));
      return /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${h.toUpperCase()}`;
    });
}

/** A path is allowed when every applicable group allows it (the strictest reading). */
export function robotsGroupsAllow(groups: RobotsRule[][], path: string): boolean {
  const canonical = canonicalPath(path);
  return groups.every((g) => robotsRulesAllow(g, canonical));
}

/** Allow/Disallow rules from the groups for "*" or our bot (both merged, the stricter reading). */
export function parseRobots(txt: string): RobotsRule[] {
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const rules: RobotsRule[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const line of lines) {
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      const match = agent === "*" || agent.includes("prawdowid");
      applies = lastWasAgent ? applies || match : match;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    // An empty Disallow (or Allow) declares nothing.
    if (applies && (key === "disallow" || key === "allow") && value) {
      // Paths are compared percent-encoded; encode raw non-ASCII in the pattern the same way.
      const pattern = value.replace(/[^\x00-\x7f]+/g, (c) => encodeURIComponent(c));
      rules.push({ allow: key === "allow", pattern });
    }
  }
  return rules;
}

/** RFC 9309 pattern match from the start of path+query: "*" = any sequence, trailing "$" = end.
 * Iterative wildcard matching (O(n·m)), no regex, so a hostile robots.txt cannot cause backtracking. */
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern + "*";
  let pi = 0, si = 0, star = -1, mark = 0;
  while (si < path.length) {
    if (pi < p.length && p[pi] !== "*" && p[pi] === path[si]) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (star !== -1) {
      pi = star + 1;
      si = ++mark;
    } else return false;
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

/** The longest matching rule decides; Allow wins a tie; no matching rule = allowed. */
export function robotsRulesAllow(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!robotsPatternMatches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

async function robotsAllows(url: URL, resolveHost?: ResolveHost): Promise<boolean> {
  const origin = url.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.at > 3600_000) {
    let groups: RobotsRule[][] = [];
    try {
      // Redirects are followed by hand, each target revalidated like an article redirect (public
      // http(s), standard port, public DNS), so a site cannot point this fetch at an internal address.
      const signal = AbortSignal.timeout(2500);
      let target = new URL("/robots.txt", origin);
      for (let hop = 0; hop <= LIMITS.urlMaxRedirects; hop++) {
        const res = await fetch(target, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          await res.body?.cancel();
          if (!loc || hop === LIMITS.urlMaxRedirects) break; // = no rules declared
          target = cleanUrl(new URL(loc, target).toString());
          await assertPublic(target, resolveHost);
          continue;
        }
        if (res.ok) groups = parseRobotsGroups((await res.text()).slice(0, 200_000));
        else await res.body?.cancel();
        break;
      }
    } catch {
      groups = []; // unreachable robots.txt (or a blocked redirect) = no restrictions declared
    }
    entry = { groups, at: Date.now() };
    robotsCache.set(origin, entry);
  }
  return robotsGroupsAllow(entry.groups, url.pathname + url.search);
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IntakeError("too_large", "Strona jest za duża do sprawdzenia.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function metaDate(doc: Document): string | null {
  const sel = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="date"]',
    'meta[name="publication_date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const s of sel) {
    const v = doc.querySelector(s)?.getAttribute("content");
    if (v) return v;
  }
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const m = (el.textContent ?? "").match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  }
  const govDate = doc.querySelector("p.event-date")?.textContent?.trim(); // gov.pl: DD.MM.YYYY
  const g = govDate?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (g) return `${g[3]}-${g[2]}-${g[1]}`;
  return doc.querySelector("time[datetime]")?.getAttribute("datetime") ?? null;
}

export async function fetchArticle(raw: string, opts: { resolveHost?: ResolveHost; signal?: AbortSignal } = {}): Promise<Article> {
  let url = cleanUrl(raw);
  const deadline = AbortSignal.timeout(LIMITS.urlFetchTimeoutMs);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;

  let res: Response | null = null;
  try {
    for (let hop = 0; hop <= LIMITS.urlMaxRedirects; hop++) {
      await assertPublic(url, opts.resolveHost);
      if (!(await robotsAllows(url, opts.resolveHost))) {
        throw new IntakeError("robots", "Ta strona nie pozwala automatom na pobieranie treści. Wklej tekst artykułu.");
      }
      res = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) throw new IntakeError("fetch_failed", "Strona przekierowuje w nieznane miejsce.");
        if (hop === LIMITS.urlMaxRedirects) throw new IntakeError("fetch_failed", "Za dużo przekierowań.");
        url = cleanUrl(new URL(loc, url).toString());
        continue;
      }
      break;
    }
  } catch (err) {
    if (err instanceof IntakeError) throw err;
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new IntakeError("timeout", "Strona odpowiada zbyt wolno.");
    }
    throw new IntakeError("fetch_failed", "Nie udało się pobrać strony.");
  }
  if (!res || !res.ok) {
    await res?.body?.cancel();
    throw new IntakeError("fetch_failed", `Strona zwróciła błąd (HTTP ${res?.status ?? "?"}). Wklej tekst artykułu.`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) {
    await res.body?.cancel();
    throw new IntakeError("unsupported", "Pod tym linkiem nie ma artykułu (to plik lub inny typ treści).");
  }
  const bytes = await readCapped(res, LIMITS.urlMaxBytes);
  const charset = type.match(/charset=([\w-]+)/i)?.[1] ?? "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }

  let title: string | null = null;
  let siteName: string | null = null;
  let published: string | null = null;
  let text = "";
  if (/text\/plain/i.test(type)) {
    text = html;
  } else {
    const { document } = parseHTML(html);
    published = metaDate(document as unknown as Document);
    siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? null;
    const article = new Readability(document as unknown as Document).parse();
    title = article?.title ?? document.querySelector("title")?.textContent ?? null;
    text = article?.textContent ?? document.body?.textContent ?? "";
    published = published ?? article?.publishedTime ?? null;
    siteName = siteName ?? article?.siteName ?? null;
  }
  text = text.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (text.length < 80) {
    throw new IntakeError("empty", "Nie udało się wyciągnąć tekstu z tej strony (może wymaga JavaScriptu lub logowania). Wklej tekst.");
  }
  const truncated = text.length > LIMITS.maxMaterialChars;
  return {
    url: url.toString(),
    title: title?.trim() || null,
    site_name: siteName,
    published_at: published,
    text: truncated ? text.slice(0, LIMITS.maxMaterialChars) : text,
    truncated,
  };
}
