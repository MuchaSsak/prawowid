/**
 * Constrained, read-only fetch for registry adapters: HTTPS only, the binding's allowed hosts only,
 * every redirect hop re-checked (host, robots.txt, private address), a time cap and a byte cap.
 * An operator can never point a binding at an arbitrary destination.
 */
import { USER_AGENT } from "../config.ts";
import { ConnectorError } from "../connectors/types.ts";
import { isPrivateIp, type ResolveHost, robotsAllows } from "../intake/url.ts";
import { normalizeHost } from "./eligibility.ts";

export interface ConstrainedFetchOptions {
  allowedHosts: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Injected for tests; default global fetch. */
  fetcher?: typeof fetch;
  /** DNS check against private addresses (SSRF). Skipped when not given (tests). */
  resolveHost?: ResolveHost;
  /** robots.txt check; default the shared intake checker. */
  robots?: (url: URL) => Promise<boolean>;
}

export interface FetchedText {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export function hostAllowed(url: URL, allowedHosts: string[]): boolean {
  const host = normalizeHost(url.hostname);
  return allowedHosts.some((h) => normalizeHost(h) === host);
}

async function guard(url: URL, opts: ConstrainedFetchOptions) {
  if (url.protocol !== "https:") throw new ConnectorError("unavailable", `tylko HTTPS: ${url.protocol}`);
  if (url.username || url.password) throw new ConnectorError("unavailable", "adres z danymi logowania");
  if (!hostAllowed(url, opts.allowedHosts)) {
    throw new ConnectorError("unavailable", `host ${url.hostname} spoza dozwolonych dla tego powiązania`);
  }
  if (opts.resolveHost) {
    const ips = await opts.resolveHost(url.hostname).catch(() => [] as string[]);
    if (!ips.length) throw new ConnectorError("unavailable", `brak DNS dla ${url.hostname}`);
    if (ips.some(isPrivateIp)) throw new ConnectorError("unavailable", "adres prywatny");
  }
  const robots = opts.robots ?? robotsAllows;
  if (!(await robots(url))) {
    throw new ConnectorError("unavailable", `robots.txt nie pozwala pobierać ${url.pathname}`);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ConnectorError("invalid_response", "odpowiedź za duża");
    }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function constrainedFetch(raw: string, opts: ConstrainedFetchOptions): Promise<FetchedText> {
  const fetcher = opts.fetcher ?? fetch;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 8_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError("unavailable", "nieprawidłowy adres");
  }
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    await guard(url, opts);
    let res: Response;
    try {
      res = await fetcher(url.href, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: opts.accept ?? "*/*" },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ConnectorError("timeout", "przekroczono czas");
      }
      throw new ConnectorError("error", (err as Error).message);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new ConnectorError("invalid_response", `przekierowanie ${res.status} bez adresu`);
      url = new URL(loc, url);
      continue;
    }
    if (res.status === 429) {
      await res.body?.cancel();
      throw new ConnectorError("rate_limited", "HTTP 429");
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ConnectorError(res.status === 404 ? "not_found" : "error", `HTTP ${res.status}`);
    }
    const body = await readCapped(res, opts.maxBytes ?? 3_000_000);
    return { url: url.href, status: res.status, contentType: res.headers.get("content-type") ?? "", body };
  }
  throw new ConnectorError("unavailable", "za dużo przekierowań");
}
