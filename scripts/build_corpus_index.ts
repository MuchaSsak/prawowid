import type { SourceRecord } from "../packages/core/src/connectors/types.ts";
import { ARTICLE_LABEL } from "../packages/core/src/connectors/google-factcheck.ts";
// Passages of ~800 characters on sentence boundaries, one sentence of overlap (tested in core).
import { passages } from "../packages/core/src/store/passages.ts";

interface AlertLine {
  source: string;
  external_id: string;
  title: string | null;
  url: string;
  published_at: string | null;
  content: string;
  summary: string | null;
  claims?: Array<{
    claim: string | null;
    rating: string | null;
    claimant?: string | null;
    claim_date?: string | null;
    review_date?: string | null;
  }>;
  source_type: "official" | "factcheck";
  /** From the raw record (convert_alert_data.ts); absent in older JSONL lines. */
  publisher?: string | null;
  retrieved_at?: string | null;
}

/** Display names when the raw record carries no `raw.publisher`; otherwise the host is shown. */
const publisherNames: Record<string, string> = {
  demagog: "Demagog",
  cert_pl: "CERT Polska",
  imgw_hydro_warnings: "IMGW-PIB",
  imgw_pshm_bulletin: "IMGW-PIB",
  gis: "Główny Inspektorat Sanitarny",
  rcb: "Rządowe Centrum Bezpieczeństwa",
  policja: "Policja",
  policja_rss: "Policja",
  mazowiecka_policja: "Komenda Stołeczna / Mazowiecka Policja",
  kgpsp: "Komenda Główna Państwowej Straży Pożarnej",
  mon: "Ministerstwo Obrony Narodowej",
  kprm: "Kancelaria Prezesa Rady Ministrów",
  mswia: "Ministerstwo Spraw Wewnętrznych i Administracji",
  mswia_rso: "Ministerstwo Spraw Wewnętrznych i Administracji",
  rso: "Regionalny System Ostrzegania (MSWiA)",
  rso_mazowieckie: "Regionalny System Ostrzegania (MSWiA)",
  rcb_report: "Rządowe Centrum Bezpieczeństwa",
  odyseusz: "Ministerstwo Spraw Zagranicznych (Odyseusz)",
  paa: "Państwowa Agencja Atomistyki",
  paa_monitoring: "Państwowa Agencja Atomistyki",
  gios: "Główny Inspektorat Ochrony Środowiska",
  infrastruktura: "Ministerstwo Infrastruktury",
  infrastruktura_info: "Ministerstwo Infrastruktury",
  gddkia: "Generalna Dyrekcja Dróg Krajowych i Autostrad",
  gddkia_info: "Generalna Dyrekcja Dróg Krajowych i Autostrad",
  gddkia_map: "Generalna Dyrekcja Dróg Krajowych i Autostrad",
  gddkia_obstacles: "Generalna Dyrekcja Dróg Krajowych i Autostrad",
  wody_polskie_navigation: "Państwowe Gospodarstwo Wodne Wody Polskie",
};

/** Demagog: the opening holds the findings ("w pigułce", the real figure); the rest is detail. */
const FACTCHECK_MAX_PASSAGES = 4;

const slug = (value: string) =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const lines = (await Deno.readTextFile("data/corpus/alert-corpus.jsonl"))
  .split(/\r?\n/)
  .filter((line) => line.trim());
const records: SourceRecord[] = [];
const builtAt = new Date().toISOString();

for (const line of lines) {
  const item = JSON.parse(line) as AlertLine;
  if (!item.url || !item.content) continue;
  const baseUrl = item.url;
  let publisher = item.publisher ?? publisherNames[item.source] ?? item.source;
  if (!item.publisher && !publisherNames[item.source]) {
    try {
      publisher = new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {}
  }
  // One publisher is one origin (decision 008): two KPRM pages never count as independent confirmation.
  const originKey = `publisher:${slug(publisher)}`;
  const docKey = item.external_id || `${item.source}:${item.url}`;
  const retrievedAt = item.retrieved_at ?? builtAt;
  const base = {
    route: "corpus" as const,
    title: item.title ?? publisher,
    publisher,
    url: baseUrl,
    published_at: item.published_at,
    retrieved_at: retrievedAt,
    origin_key: originKey,
  };
  if (item.source_type === "factcheck") {
    // Verdict cards, in the same labelled shape as Google Fact Check passages, so the assessment
    // prompt's FACT-CHECK PASSAGES rules apply to them unchanged.
    for (const [index, claim] of (item.claims ?? []).entries()) {
      if (!claim.claim && !claim.rating) continue;
      const text = [
        claim.claim ? `Sprawdzane twierdzenie: "${claim.claim}"` : "",
        claim.claimant ? `Autor twierdzenia: ${claim.claimant}.` : "",
        claim.claim_date ? `Data twierdzenia: ${claim.claim_date}.` : "",
        `Ocena (${publisher}): ${claim.rating ?? "brak"}.`,
        item.title ? `Tytuł weryfikacji: ${item.title}` : "",
      ].filter(Boolean).join("\n");
      records.push({ ...base, source_id: `corpus:demagog:${index}:${docKey}`, tier: "factcheck", text });
    }
    // The opening of the article: the fact-checker's own findings.
    for (const [index, p] of passages(item.content).slice(0, FACTCHECK_MAX_PASSAGES).entries()) {
      records.push({
        ...base,
        source_id: `corpus:demagog:a${index}:${docKey}`,
        tier: "factcheck",
        text: `${ARTICLE_LABEL} ${p.text}`,
      });
    }
  } else {
    for (const [index, p] of passages(item.content).entries()) {
      records.push({
        ...base,
        source_id: `corpus:${item.source}:${index}:${docKey}`,
        tier: "official",
        text: p.text,
        start_offset: p.start,
        end_offset: p.end,
      });
    }
  }
}

await Deno.mkdir("data/corpus", { recursive: true });
// Compact JSON: the pretty-printed index was ~40% whitespace.
await Deno.writeTextFile(
  "data/corpus/alert-corpus-index.json",
  JSON.stringify({ version: 1, generated_at: builtAt, records }),
);
console.log(`Zbudowano indeks ${records.length} fragmentów z ${lines.length} rekordów`);
