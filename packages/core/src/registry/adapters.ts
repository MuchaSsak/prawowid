/**
 * Supported adapter types. All read-only. An operator picks one and fills its fields; JSON templates
 * (query URL and field mapping) are reviewed here in code. There is no free-form URL or code editor:
 * a new format calls for a new adapter or template (architecture/source-platform.md).
 */
import type { AdapterType, Binding, BindingMode } from "./types.ts";
import { constrainedFetch, type ConstrainedFetchOptions, hostAllowed } from "./fetch.ts";

export const BUILTIN_CONNECTORS = ["google_factcheck", "sejm_eli", "eurostat", "nbp", "gus_bdl"] as const;

export interface AdapterField {
  name: string;
  label: string;
  kind: "url" | "text" | "number" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface AdapterSpec {
  type: AdapterType;
  label: string;
  mode: BindingMode;
  /** Operators can add it from the panel (builtin bindings come from code only). */
  operator_addable: boolean;
  fields: AdapterField[];
}

/** An item an adapter fetched, before it becomes a corpus document or a live record. */
export interface AdapterItem {
  title: string;
  url: string;
  published_at: string | null;
  updated_at: string | null;
  text: string;
}

export interface JsonTemplate {
  id: string;
  label: string;
  description: string;
  /** Builds the request from the binding's base URL and the query. */
  buildUrl(baseUrl: string, query: string, limit: number): string;
  map(json: unknown): AdapterItem[];
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return HTML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Markup to plain text: drop scripts/styles and tags, decode entities, collapse whitespace. */
export function htmlToText(html: string): string {
  const noCdata = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(
    noCdata
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function isoOrNull(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1];
  }
  return null;
}

/** RSS 2.0 and Atom items. Minimal and tolerant; never executes anything from the feed. */
export function parseFeed(xml: string, maxItems = 30): AdapterItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]).slice(
    0,
    maxItems,
  );
  const items: AdapterItem[] = [];
  for (const b of blocks) {
    const title = htmlToText(tag(b, ["title"]) ?? "");
    let link = htmlToText(tag(b, ["link"]) ?? "");
    if (!link) {
      link = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
        b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? "";
    }
    const body = tag(b, ["content:encoded", "content", "description", "summary"]) ?? "";
    const published = isoOrNull(tag(b, ["pubDate", "published", "dc:date", "updated"]));
    const updated = isoOrNull(tag(b, ["updated", "atom:updated"])) ?? published;
    const text = htmlToText(body);
    if (!link || !(title || text)) continue;
    items.push({
      title: title || link,
      url: decodeEntities(link.trim()),
      published_at: published,
      updated_at: updated,
      text: text || title,
    });
  }
  return items;
}

/** WordPress REST: posts search. The only JSON template in the prototype. */
const wordpressPosts: JsonTemplate = {
  id: "wordpress_posts",
  label: "WordPress REST: wpisy (/wp-json/wp/v2/posts)",
  description: "Wyszukuje wpisy przez ?search=, pola: tytuł, link, data, treść.",
  buildUrl(baseUrl, query, limit) {
    const u = new URL("/wp-json/wp/v2/posts", baseUrl);
    u.searchParams.set("search", query);
    u.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 10)));
    u.searchParams.set("_fields", "link,date_gmt,modified_gmt,title,excerpt,content");
    return u.href;
  },
  map(json) {
    if (!Array.isArray(json)) return [];
    return json.flatMap((p: Record<string, unknown>): AdapterItem[] => {
      const r = (k: string) => ((p[k] as { rendered?: string } | undefined)?.rendered ?? "");
      const link = typeof p.link === "string" ? p.link : "";
      if (!link) return [];
      const date = typeof p.date_gmt === "string" ? isoOrNull(`${p.date_gmt}Z`) : null;
      const modified = typeof p.modified_gmt === "string" ? isoOrNull(`${p.modified_gmt}Z`) : date;
      return [{
        title: htmlToText(r("title")) || link,
        url: link,
        published_at: date,
        updated_at: modified,
        text: htmlToText(r("content") || r("excerpt")),
      }];
    });
  },
};

export const JSON_TEMPLATES: Record<string, JsonTemplate> = { [wordpressPosts.id]: wordpressPosts };

export const ADAPTERS: AdapterSpec[] = [
  {
    type: "builtin",
    label: "Wbudowany konektor (w kodzie)",
    mode: "live",
    operator_addable: false,
    fields: [],
  },
  {
    type: "rss",
    label: "Kanał RSS / Atom",
    mode: "corpus",
    operator_addable: true,
    fields: [
      {
        name: "feed_url",
        label: "Adres kanału",
        kind: "url",
        required: true,
        placeholder: "https://…/rss.xml",
      },
      { name: "interval_minutes", label: "Co ile minut", kind: "number", required: false, placeholder: "60" },
      { name: "max_items", label: "Maks. wpisów", kind: "number", required: false, placeholder: "30" },
    ],
  },
  { type: "upload", label: "Dokumenty dodawane ręcznie", mode: "corpus", operator_addable: true, fields: [] },
  {
    type: "json_template",
    label: "Szablon JSON (sprawdzony w kodzie)",
    mode: "live",
    operator_addable: true,
    fields: [
      {
        name: "template",
        label: "Szablon",
        kind: "select",
        required: true,
        options: Object.values(JSON_TEMPLATES).map((t) => ({ value: t.id, label: t.label })),
      },
      {
        name: "base_url",
        label: "Adres serwisu",
        kind: "url",
        required: true,
        placeholder: "https://example.pl",
      },
    ],
  },
];

function httpsUrl(v: unknown): URL | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Adapter-specific checks, run before any sample request and before activation. */
export function validateBindingConfig(b: Binding): string[] {
  const errors: string[] = [];
  const at = `powiązanie ${b.id}`;
  const spec = ADAPTERS.find((a) => a.type === b.adapter);
  if (!spec) return [`${at}: nieznany typ adaptera ${b.adapter}`];
  if (b.mode !== spec.mode) errors.push(`${at}: adapter ${b.adapter} działa w trybie ${spec.mode}`);
  if (b.aggregator && b.adapter !== "builtin") errors.push(`${at}: agregator może być tylko wbudowany`);
  if (!b.aggregator && !b.publisher_id) errors.push(`${at}: brak wydawcy`);
  const num = (k: string, min: number, max: number) => {
    const v = b.config[k];
    if (v === undefined || v === "") return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      errors.push(`${at}: ${k} musi być liczbą ${min}-${max}`);
    }
  };
  switch (b.adapter) {
    case "builtin":
      if (!(BUILTIN_CONNECTORS as readonly string[]).includes(String(b.config.connector))) {
        errors.push(`${at}: nieznany konektor ${b.config.connector}`);
      }
      break;
    case "rss": {
      const u = httpsUrl(b.config.feed_url);
      if (!u) errors.push(`${at}: adres kanału musi być pełnym adresem https://`);
      else if (!hostAllowed(u, b.allowed_hosts)) {
        errors.push(`${at}: host kanału ${u.hostname} spoza dozwolonych hostów`);
      }
      num("interval_minutes", 15, 10_080);
      num("max_items", 1, 100);
      break;
    }
    case "upload":
      if (b.allowed_hosts.length) {
        errors.push(`${at}: dokumenty ręczne nie wysyłają zapytań (bez dozwolonych hostów)`);
      }
      break;
    case "json_template": {
      if (!JSON_TEMPLATES[String(b.config.template)]) {
        errors.push(`${at}: nieznany szablon ${b.config.template}`);
      }
      const u = httpsUrl(b.config.base_url);
      if (!u) errors.push(`${at}: adres serwisu musi być pełnym adresem https://`);
      else if (!hostAllowed(u, b.allowed_hosts)) {
        errors.push(`${at}: host ${u.hostname} spoza dozwolonych hostów`);
      }
      break;
    }
  }
  return errors;
}

export type FetchDeps = Omit<ConstrainedFetchOptions, "allowedHosts" | "accept">;

/** RSS: fetch and parse the feed (no commit; ingestion decides what is stored). */
export async function fetchFeed(b: Binding, deps: FetchDeps = {}): Promise<AdapterItem[]> {
  const res = await constrainedFetch(String(b.config.feed_url), {
    ...deps,
    allowedHosts: b.allowed_hosts,
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
  });
  if (/text\/html/i.test(res.contentType) && !/<(rss|feed)[\s>]/i.test(res.body)) {
    throw new Error("pod tym adresem jest strona HTML, nie kanał RSS");
  }
  return parseFeed(res.body, Number(b.config.max_items) || 30);
}

/** JSON template: one live query. */
export async function fetchTemplate(
  b: Binding,
  query: string,
  deps: FetchDeps = {},
  limit = 5,
): Promise<AdapterItem[]> {
  const t = JSON_TEMPLATES[String(b.config.template)];
  if (!t) throw new Error(`nieznany szablon ${b.config.template}`);
  const res = await constrainedFetch(t.buildUrl(String(b.config.base_url), query, limit), {
    ...deps,
    allowedHosts: b.allowed_hosts,
    accept: "application/json",
  });
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error("odpowiedź nie jest JSON-em");
  }
  return t.map(json);
}
