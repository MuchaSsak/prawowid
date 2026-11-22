// Real HTML tags only: a literal "<" ("<50% normy", "<= 2025.12.5") must survive.
// Real tags only (name right after "<", quoted attributes may hold ">"), plus comments and doctype;
// a literal "<50% normy" or "<x+2 >" stays text.
const htmlTagPattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>/gi;
const base64Pattern = /(?:data:[^;]+;base64,[A-Za-z0-9+/=]+|[A-Za-z0-9+/]{80,}={0,2})/g;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(base64Pattern, "")
    .replace(htmlTagPattern, " ")
    .replace(/\\u[a-fA-F0-9]{4}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Unicode letter/number classes, so Cyrillic (e.g. Ukrainian Demagog articles) passes too.
  if (text.length < 20 || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^\s*(?:null|undefined|true|false)\s*$/i.test(text)) return null;
  return text;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = value.trim();
  const ddMmYyyy = direct.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:$|[^0-9])/);
  if (ddMmYyyy) {
    const [, d, m, y] = ddMmYyyy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const yyyyMmDd = direct.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (yyyyMmDd) {
    const [, y, m, d] = yyyyMmDd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = Date.parse(direct);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Markdown fragment -> plain lines, each closed with punctuation so the index splits it into sentences. */
function markdownToLines(markdown: string): string[] {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => /[.!?:;…]$/.test(line) ? line : `${line}.`);
}

/**
 * Nested CMS page (e.g. Odyseusz "strony tematyczne"): `sekcje[]` / `podsekcje[]` / `podstrony[]`
 * objects with `tytul`/`nazwa` headings and markdown `tresc`. Flattened depth-first into text.
 * Returns null when the tree has no body text (link-only menus stay out of the corpus).
 */
function flattenSectionTree(root: Record<string, unknown>): string | null {
  const out: string[] = [];
  let bodyLines = 0;
  const childKeys = ["sekcje", "podsekcje", "podstrony"];
  const byOrder = (items: unknown[]) =>
    items.map(asObject).filter((item): item is Record<string, unknown> => item !== null)
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        (typeof a.item.uporzadkowanie === "number" ? a.item.uporzadkowanie : Infinity) -
          (typeof b.item.uporzadkowanie === "number" ? b.item.uporzadkowanie : Infinity) || a.index - b.index
      )
      .map(({ item }) => item);
  const visit = (node: Record<string, unknown>, isRoot: boolean) => {
    const heading = typeof node.tytul === "string"
      ? node.tytul
      : typeof node.nazwa === "string"
      ? node.nazwa
      : null;
    if (heading && !isRoot) out.push(...markdownToLines(heading));
    if (typeof node.tresc === "string") {
      const lines = markdownToLines(node.tresc);
      bodyLines += lines.length;
      out.push(...lines);
    }
    for (const key of childKeys) {
      if (Array.isArray(node[key])) {
        for (const child of byOrder(node[key] as unknown[])) visit(child, false);
      }
    }
  };
  visit(root, true);
  return bodyLines > 0 ? cleanText(out.join("\n")) : null;
}

const warsawDateTime = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function polishDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const parts = Object.fromEntries(
    warsawDateTime.formatToParts(new Date(parsed)).map((p) => [p.type, p.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year}, godz. ${parts.hour}:${parts.minute}`;
}

function roadPhrase(roadNumber: string): string {
  if (/^A\d/i.test(roadNumber)) return `autostradzie ${roadNumber}`;
  if (/^S\d/i.test(roadNumber)) return `drodze ekspresowej ${roadNumber}`;
  if (/^\d/.test(roadNumber)) return `drodze krajowej nr ${roadNumber}`;
  return `drodze ${roadNumber}`;
}

/**
 * Road-situation record (GDDKiA map) with no or very short description: compose a short factual
 * Polish text from the structured fields (road, kind from "<road> - <kind>" title, validity dates).
 */
function composeRoadSituation(record: Record<string, unknown>, raw: Record<string, unknown>): string | null {
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const titleMatch = title.match(/^\s*([^\s-][^-]*?)\s+-\s+(.+)$/);
  const roadNumber = typeof raw.road_number === "string" && raw.road_number.trim()
    ? raw.road_number.trim()
    : titleMatch?.[1]?.trim();
  if (!roadNumber) return null;
  const roadName = typeof raw.road_name === "string" && raw.road_name.trim()
    ? ` (${raw.road_name.trim()})`
    : "";
  const kind = titleMatch?.[2]?.trim() || title;
  const description = typeof record.content === "string" ? record.content.replace(/\s+/g, " ").trim() : "";
  const from = polishDateTime(record.valid_from);
  const to = polishDateTime(record.valid_to);
  const published = polishDateTime(record.published_at);
  const sentences = [
    `Utrudnienie w ruchu na ${roadPhrase(roadNumber)}${roadName}: ${kind}${
      description ? ` – ${description.replace(/[.!?…]+$/, "")}` : ""
    }.`,
    from
      ? `Obowiązuje od ${from}${to ? ` do ${to}` : " (bez podanego terminu zakończenia)"}.`
      : to
      ? `Obowiązuje do ${to}.`
      : null,
    published ? `Informacja opublikowana na mapie informacji drogowej GDDKiA ${published}.` : null,
  ];
  return cleanText(sentences.filter(Boolean).join(" "));
}

/** Text for records whose `content` is missing or unusable but whose raw payload is structured. */
function structuredContent(record: Record<string, unknown>): string | null {
  const raw = asObject(record.raw);
  if (!raw) return null;
  const payload = asObject(raw.payload);
  if (payload && ["sekcje", "podsekcje", "podstrony"].some((key) => Array.isArray(payload[key]))) {
    const flattened = flattenSectionTree(payload);
    if (flattened) return flattened;
  }
  // Only road *situations* (incidents, works); VMS boards, MOPs etc. are not "utrudnienia".
  if (raw.layer === "situations" || record.category === "situations") {
    return composeRoadSituation(record, raw);
  }
  return null;
}

async function jsonDirs(): Promise<string[]> {
  const dirs = ["../data", "data/raw"];
  const out: string[] = [];
  for (const dir of dirs) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".json")) out.push(`${dir}/${entry.name}`);
      }
    } catch {
      // Optional source snapshot outside this repository.
    }
  }
  // Sorted so the generated JSONL (and its git diff) does not depend on directory listing order.
  return [...new Set(out)].sort();
}

/**
 * Live-state snapshots: what the source showed when it was collected, not a dated publication.
 * Their text starts with "Stan na <time>" so nobody cites an expired state as current.
 */
const SNAPSHOT_SOURCES = new Set(["gddkia_map", "gddkia_obstacles", "rso", "rso_mazowieckie", "paa_monitoring", "gios"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Metadata the raw records already carry, passed through to the index builder. */
function metadata(record: Record<string, unknown>) {
  const raw = asObject(record.raw) ?? {};
  const location = Array.isArray(record.location)
    ? record.location.filter((x): x is string => typeof x === "string" && x.trim().length > 0 && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(x))
    : [];
  return {
    publisher: str(raw.publisher),
    retrieved_at: str(record.last_seen_at) ?? str(record.first_seen_at),
    updated_at: isoDate(record.updated_at),
    valid_from: str(record.valid_from),
    valid_to: str(record.valid_to),
    location,
    category: str(record.category),
    date_issue: str(raw.date_issue),
  };
}

/** One leading sentence with the validity period or the snapshot time, built from structured fields. */
function stateHeader(source: string, record: Record<string, unknown>, content: string): string | null {
  if (/^Obowiązuje (od|do) /.test(content) || content.includes(" Obowiązuje od ")) return null; // GDDKiA map text has it
  const from = polishDateTime(record.valid_from);
  const to = polishDateTime(record.valid_to);
  const parts: string[] = [];
  if (SNAPSHOT_SOURCES.has(source)) {
    const seen = polishDateTime(record.last_seen_at ?? record.first_seen_at);
    if (seen) parts.push(`Stan na ${seen} (dane bieżące w chwili pobrania).`);
  }
  if (from || to) parts.push(from ? `Obowiązuje od ${from}${to ? ` do ${to}` : ""}.` : `Obowiązuje do ${to}.`);
  return parts.length ? parts.join(" ") : null;
}

const files = await jsonDirs();
const lines: string[] = [];
// The same record may be read from ../data and data/raw: keep the first copy only.
const seenKeys = new Set<string>();
for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(file));
  } catch {
    continue;
  }
  const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const source = typeof record.source === "string"
      ? record.source
      : file.split("/").pop()?.replace(/\.json$/, "") ?? "unknown";
    const content = cleanText(record.content);
    const summary = cleanText(record.summary);
    // Fallback text built from the structured raw payload, only when the record has no usable text.
    const structured = content || summary ? null : structuredContent(record);
    // Titles are often short ("S6 - Wypadki", "Pomoc za granicą"); keep any real one instead of
    // letting the 20-character body-text threshold drop it (a citation without a title shows a hostname).
    const rawTitle = typeof record.title === "string" ? record.title.replace(htmlTagPattern, " ").replace(/\s+/g, " ").trim() : "";
    const title = cleanText(record.title) ??
      (rawTitle && rawTitle !== "None" && /[\p{L}\p{N}]/u.test(rawTitle) ? rawTitle : null);
    if (!title && !content && !summary && !structured) continue;
    const url = typeof record.detail_url === "string"
      ? record.detail_url
      : typeof record.source_url === "string"
      ? record.source_url
      : typeof record.external_id === "string"
      ? record.external_id
      : "";
    const externalId = record.external_id ?? url;
    const key = `${source}\u0000${externalId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const meta = metadata(record);
    const claims: unknown[] = [];
    if (source === "demagog" && record.raw && typeof record.raw === "object") {
      const raw = record.raw as Record<string, unknown>;
      if (Array.isArray(raw.claim_reviews)) {
        for (const review of raw.claim_reviews) {
          if (!review || typeof review !== "object") continue;
          const r = review as Record<string, unknown>;
          const claim = cleanText(r.claim);
          const rating = cleanText(r.rating);
          if (claim || rating) {
            claims.push({
              claim,
              rating,
              claimant: str(r.claimant),
              claim_date: isoDate(r.claim_date),
              review_date: isoDate(r.review_date),
            });
          }
        }
      }
    }
    if (source === "demagog") {
      // The article body holds the fact-checker's findings (the real figure, date, place); the
      // index builder keeps its opening next to the verdict card. Older text as a fallback.
      const fallback = [
        title,
        summary,
        claims.map((c) => {
          const r = c as Record<string, unknown>;
          return [r.claim, r.rating ? `Ocena: ${r.rating}` : null].filter(Boolean).join(". ");
        }).join("\n"),
      ].filter(Boolean).join("\n");
      const cleaned = content ?? cleanText(fallback);
      if (!cleaned) continue;
      lines.push(JSON.stringify({
        source,
        external_id: externalId,
        title,
        url,
        published_at: isoDate(record.published_at),
        content: cleaned,
        summary,
        claims,
        source_type: "factcheck",
        ...meta,
        publisher: meta.publisher ?? "Demagog",
      }));
    } else {
      const body = cleanText(content) ?? summary ?? structured;
      if (!body) continue;
      const header = stateHeader(source, record, body);
      lines.push(JSON.stringify({
        source,
        external_id: externalId,
        title,
        url,
        published_at: isoDate(record.published_at),
        content: header ? `${header} ${body}` : body,
        summary,
        source_type: "official",
        ...meta,
      }));
    }
  }
}

await Deno.mkdir("data/corpus", { recursive: true });
await Deno.writeTextFile("data/corpus/alert-corpus.jsonl", lines.join("\n") + (lines.length ? "\n" : ""));
console.log(
  `Wczytano ${files.length} plików JSON, zapisano ${lines.length} rekordów do data/corpus/alert-corpus.jsonl`,
);
