/**
 * EUvsDisinfo MCP client (https://mcp.euvsd.info/mcp), stateless mode: one `tools/call` per request,
 * no `initialize`, a client-generated `mcp-session-id`. Used at check time (search) and by the bulk
 * ingest (cases, articles). Wiki: architecture/euvsdisinfo-mcp.md.
 *
 * The key goes in the Authorization header, never in the URL, so it cannot end up in request logs.
 */
import { ConnectorError } from "../../connectors/types.ts";
import type { KnownIncident } from "../types.ts";

export const EUVSD_ENDPOINT = "https://mcp.euvsd.info/mcp";

export interface CallOptions {
  token: string;
  signal: AbortSignal;
  timeoutMs: number;
  endpoint?: string;
}

/** Response bodies come as SSE (`event: message` / `data: {...}`) or plain JSON. Returns the JSON-RPC message. */
export function parseRpcBody(body: string, contentType: string | null): unknown {
  const trimmed = body.trim();
  if (!contentType?.includes("text/event-stream") && trimmed.startsWith("{")) return JSON.parse(trimmed);
  // SSE: an event's data may span several `data:` lines; take the last complete event that is JSON.
  let last: unknown = undefined;
  for (const event of trimmed.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      last = JSON.parse(data);
    } catch { /* keep-alive or partial event */ }
  }
  if (last === undefined) throw new ConnectorError("invalid_response", "no JSON-RPC message in the response");
  return last;
}

interface RpcMessage {
  result?: { structuredContent?: unknown; content?: { type: string; text?: string }[]; isError?: boolean };
  error?: { code: number; message: string };
}

/** The tool's payload: structuredContent when present, else the first text block parsed as JSON. */
export function toolPayload(msg: unknown): unknown {
  const m = msg as RpcMessage;
  if (m.error) throw new ConnectorError(m.error.code === -32001 ? "unavailable" : "error", `MCP ${m.error.code}: ${m.error.message}`);
  if (!m.result) throw new ConnectorError("invalid_response", "no result");
  if (m.result.isError) throw new ConnectorError("error", m.result.content?.[0]?.text?.slice(0, 200) ?? "tool error");
  if (m.result.structuredContent !== undefined) return m.result.structuredContent;
  const text = m.result.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    // Some tools only return a human-readable text block.
    return { text };
  }
}

export async function callTool(name: string, args: Record<string, unknown>, opt: CallOptions): Promise<unknown> {
  const once = async () => {
    let res: Response;
    try {
      res = await fetch(opt.endpoint ?? EUVSD_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.any([opt.signal, AbortSignal.timeout(opt.timeoutMs)]),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${opt.token}`,
          "mcp-session-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ConnectorError("timeout", "timeout");
      }
      throw new ConnectorError("error", (err as Error).message);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new ConnectorError("unavailable", `HTTP ${res.status} (klucz EUvsDisinfo odrzucony)`);
    }
    if (res.status === 429) {
      await res.body?.cancel();
      throw new ConnectorError("rate_limited", "HTTP 429");
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ConnectorError("error", `HTTP ${res.status}`);
    }
    let msg: unknown;
    try {
      msg = parseRpcBody(await res.text(), res.headers.get("content-type"));
    } catch (err) {
      throw err instanceof ConnectorError ? err : new ConnectorError("invalid_response", "invalid JSON");
    }
    return toolPayload(msg);
  };
  try {
    return await once();
  } catch (err) {
    const transient = err instanceof ConnectorError && (err.kind === "error" || err.kind === "rate_limited");
    if (!transient || opt.signal.aborted) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return await once();
  }
}

// ── search ───────────────────────────────────────────────────────────────────

export interface SearchHit {
  type: "article" | "claim_review" | string;
  title: string;
  content: string;
  link: string;
}

/** Content comes as WordPress HTML (seen live 2026-11-21): tags out, common entities decoded, spaces collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Live shape (2026-11-21): {"results":[{type,title,content,link}]}; a bare array is accepted too. */
export function normalizeSearch(payload: unknown): SearchHit[] {
  const arr = Array.isArray(payload)
    ? payload
    : Object.values((payload ?? {}) as Record<string, unknown>).find(Array.isArray) ?? [];
  return (arr as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      type: String(x.type ?? ""),
      title: htmlToText(String(x.title ?? "")),
      content: htmlToText(String(x.content ?? "")),
      link: String(x.link ?? x.url ?? ""),
    }))
    .filter((x) => x.title && x.link);
}

export async function search(query: string, opt: CallOptions & { date_from?: string; date_to?: string }) {
  const args: Record<string, unknown> = { query };
  if (opt.date_from) args.date_from = opt.date_from;
  if (opt.date_to) args.date_to = opt.date_to;
  return normalizeSearch(await callTool("search", args, opt));
}

// ── bulk listing (ingest) ──────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  total: number | null;
  hasNextPage: boolean;
}

export interface EuvsdCase {
  id: string;
  title: string;
  claim: string;
  fact: string;
  date: number;
  keywords?: { _id?: string; title?: string }[];
  countries?: { _id?: string; title?: string }[];
  linksToDisinformation?: { url?: string; language?: { name?: string } }[];
  url: string;
}

export interface EuvsdArticle {
  id: string | number;
  title: string;
  content: string;
  dateGmt: string;
  keywords?: unknown[];
  articleLanguage?: { slug?: string; name?: string }[];
  url: string;
}

function page<T>(payload: unknown, key: string): Page<T> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(p[key]) ? p[key] : Object.values(p).find(Array.isArray) ?? []) as T[];
  return { items, total: typeof p.total === "number" ? p.total : null, hasNextPage: p.hasNextPage === true };
}

export async function listCases(offset: number, limit: number, opt: CallOptions): Promise<Page<EuvsdCase>> {
  return page<EuvsdCase>(await callTool("cases", { offset, limit }, opt), "cases");
}

export async function listArticles(offset: number, limit: number, opt: CallOptions): Promise<Page<EuvsdArticle>> {
  return page<EuvsdArticle>(await callTool("articles", { offset, limit }, opt), "articles");
}

// ── mapping into our normalized record ─────────────────────────────────────────

function host(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export function caseToIncident(c: EuvsdCase, retrievedAt: string): KnownIncident {
  const links = c.linksToDisinformation ?? [];
  return {
    id: `euvsdisinfo:case:${c.id}`,
    catalog: "EUvsDisinfo",
    record_type: "case",
    title: c.title,
    claim: c.claim ?? "",
    fact: c.fact ?? "",
    url: c.url,
    published_at: Number.isFinite(c.date) ? new Date(c.date * 1000).toISOString() : null,
    keywords: uniq((c.keywords ?? []).map((k) => k.title)),
    countries: uniq((c.countries ?? []).map((k) => k.title)),
    languages: uniq(links.map((l) => l.language?.name)),
    outlet_hosts: uniq(links.map((l) => host(l.url))),
    retrieved_at: retrievedAt,
  };
}

export function articleToIncident(a: EuvsdArticle, retrievedAt: string): KnownIncident {
  const t = Date.parse(a.dateGmt?.endsWith("Z") ? a.dateGmt : `${a.dateGmt}Z`);
  return {
    id: `euvsdisinfo:article:${a.id}`,
    catalog: "EUvsDisinfo",
    record_type: "article",
    title: a.title,
    claim: htmlToText(a.content ?? "").slice(0, 1000),
    fact: "",
    url: a.url,
    published_at: Number.isNaN(t) ? null : new Date(t).toISOString(),
    keywords: uniq((a.keywords ?? []).map((k) => (typeof k === "string" ? k : (k as { title?: string })?.title))),
    countries: [],
    languages: uniq((a.articleLanguage ?? []).map((l) => l.name)),
    outlet_hosts: [],
    retrieved_at: retrievedAt,
  };
}
