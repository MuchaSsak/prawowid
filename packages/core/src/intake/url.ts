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
const PRIVATE_PARAM = /(token|key|pass|pwd|secret|session|sid|auth|sig|signature|email|phone|code)/i;

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
    else if (PRIVATE_PARAM.test(key)) {
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
const robotsCache = new Map<string, { rules: string[]; at: number }>();

function parseRobots(txt: string): string[] {
  // Collect Disallow rules from groups for "*" or our bot. Minimal, prefix-based.
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const disallow: string[] = [];
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
    if (applies && key === "disallow" && value) disallow.push(value);
  }
  return disallow;
}

async function robotsAllows(url: URL): Promise<boolean> {
  const origin = url.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.at > 3600_000) {
    let rules: string[] = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(2500),
        redirect: "follow",
      });
      if (res.ok) rules = parseRobots((await res.text()).slice(0, 200_000));
    } catch {
      rules = []; // unreachable robots.txt = no restrictions declared
    }
    entry = { rules, at: Date.now() };
    robotsCache.set(origin, entry);
  }
  const path = url.pathname + url.search;
  return !entry.rules.some((rule) => {
    const prefix = rule.replace(/\*.*$/, "").replace(/\$$/, "");
    return prefix !== "" && path.startsWith(prefix);
  });
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
      if (!(await robotsAllows(url))) {
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
