const base64Pattern = /(?:data:[^;]+;base64,[A-Za-z0-9+/=]+|[A-Za-z0-9+/]{80,}={0,2})/g;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .replace(base64Pattern, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u[a-fA-F0-9]{4}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 20 || !/[A-Za-zÀ-źŁłĆćĘęŃńÓóŚśŹźŻż0-9]/.test(text)) return null;
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
  return [...new Set(out)];
}

const files = await jsonDirs();
const lines: string[] = [];
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
    const title = cleanText(record.title);
    if (!title && !content && !summary) continue;
    const url = typeof record.detail_url === "string"
      ? record.detail_url
      : typeof record.source_url === "string"
      ? record.source_url
      : typeof record.external_id === "string"
      ? record.external_id
      : "";
    const claims: unknown[] = [];
    if (source === "demagog" && record.raw && typeof record.raw === "object") {
      const raw = record.raw as Record<string, unknown>;
      if (Array.isArray(raw.claim_reviews)) {
        for (const review of raw.claim_reviews) {
          if (!review || typeof review !== "object") continue;
          const r = review as Record<string, unknown>;
          const claim = cleanText(r.claim);
          const rating = cleanText(r.rating);
          if (claim || rating) claims.push({ claim, rating });
        }
      }
    }
    if (source === "demagog") {
      const text = [
        title,
        summary,
        claims.map((c) => {
          const r = c as Record<string, unknown>;
          return [r.claim, r.rating ? `Ocena: ${r.rating}` : null].filter(Boolean).join(". ");
        }).join("\n"),
      ].filter(Boolean).join("\n");
      const cleaned = cleanText(text);
      if (!cleaned) continue;
      lines.push(JSON.stringify({
        source,
        external_id: record.external_id ?? url,
        title,
        url,
        published_at: isoDate(record.published_at),
        content: cleaned,
        summary,
        claims,
        source_type: "factcheck",
      }));
    } else {
      const cleaned = cleanText(content) ?? summary;
      if (!cleaned) continue;
      lines.push(JSON.stringify({
        source,
        external_id: record.external_id ?? url,
        title,
        url,
        published_at: isoDate(record.published_at),
        content: cleaned,
        summary,
        source_type: "official",
      }));
    }
  }
}

await Deno.mkdir("data/corpus", { recursive: true });
await Deno.writeTextFile("data/corpus/alert-corpus.jsonl", lines.join("\n") + (lines.length ? "\n" : ""));
console.log(
  `Wczytano ${files.length} plików JSON, zapisano ${lines.length} rekordów do data/corpus/alert-corpus.jsonl`,
);
