import type { SourceRecord } from "../packages/core/src/connectors/types.ts";

interface AlertLine {
  source: string;
  external_id: string;
  title: string | null;
  url: string;
  published_at: string | null;
  content: string;
  summary: string | null;
  claims?: Array<{ claim: string | null; rating: string | null }>;
  source_type: "official" | "factcheck";
}

const publisherNames: Record<string, string> = {
  demagog: "Demagog",
  cert_pl: "CERT Polska",
  imgw_hydro_warnings: "IMGW",
  imgw_pshm_bulletin: "IMGW",
  gis: "Główny Inspektorat Sanitarny",
  rcb: "Rządowe Centrum Bezpieczeństwa",
  policja: "Policja",
};

const lines = (await Deno.readTextFile("data/corpus/alert-corpus.jsonl"))
  .split(/\r?\n/)
  .filter((line) => line.trim());
const records: SourceRecord[] = [];

for (const line of lines) {
  const item = JSON.parse(line) as AlertLine;
  if (!item.url || !item.content) continue;
  const baseUrl = item.url;
  let publisher = publisherNames[item.source] ?? item.source;
  try {
    publisher = publisherNames[item.source] ?? new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {}
  const originKey = item.external_id || `${item.source}:${item.url}`;
  if (item.source_type === "factcheck") {
    const excerpts = item.claims?.length
      ? item.claims.map((claim) =>
        [claim.claim, claim.rating ? `Ocena: ${claim.rating}` : null].filter(Boolean).join(". ")
      )
      : [item.summary ?? item.title ?? item.content].filter(Boolean);
    for (const [index, excerpt] of excerpts.entries()) {
      if (!excerpt || excerpt.length < 20) continue;
      const start = item.content.indexOf(excerpt);
      records.push({
        source_id: `corpus:demagog:${index}:${originKey}`,
        route: "corpus",
        title: item.title ?? excerpt,
        publisher,
        url: baseUrl,
        published_at: item.published_at,
        retrieved_at: new Date().toISOString(),
        tier: "factcheck",
        origin_key: originKey,
        text: excerpt,
        start_offset: start >= 0 ? start : undefined,
        end_offset: start >= 0 ? start + excerpt.length : undefined,
      });
    }
  } else {
    const fragments = item.content
      .split(/(?<=[.!?])\s+(?=[A-ZŻŹĆŚŃŁÓĘĄ])/)
      .filter((fragment) => fragment.length >= 25);
    for (const [index, fragment] of fragments.entries()) {
      const start = item.content.indexOf(fragment);
      records.push({
        source_id: `corpus:${item.source}:${index}:${originKey}`,
        route: "corpus",
        title: item.title ?? publisher,
        publisher,
        url: baseUrl,
        published_at: item.published_at,
        retrieved_at: new Date().toISOString(),
        tier: "official",
        origin_key: originKey,
        text: fragment,
        start_offset: start >= 0 ? start : undefined,
        end_offset: start >= 0 ? start + fragment.length : undefined,
      });
    }
  }
}

await Deno.mkdir("data/corpus", { recursive: true });
await Deno.writeTextFile(
  "data/corpus/alert-corpus-index.json",
  JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      records,
    },
    null,
    2,
  ),
);
console.log(`Zbudowano indeks ${records.length} fragmentów z ${lines.length} rekordów`);
