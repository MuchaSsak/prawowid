/**
 * Google Fact Check Tools API (ClaimReview from Demagog, AFP Sprawdzam, Konkret24, …).
 * Verified endpoint: architecture/api-endpoints-verified.md. Needs GOOGLE_FACT_CHECK_API_KEY with the
 * "Fact Check Tools API" enabled in the Google Cloud project.
 * Only publishers on the trusted-source allowlist (sources/catalog.ts) are kept; the catalog sets the tier.
 */
import { LIMITS } from "../config.ts";
import { fetchArticle } from "../intake/url.ts";
import { trustedSourceFor } from "../sources/catalog.ts";
import { type Connector, ConnectorError, fetchJson, type SourceRecord } from "./types.ts";

interface ClaimReviewResponse {
  claims?: {
    text?: string;
    claimant?: string;
    claimDate?: string;
    claimReview?: {
      publisher?: { name?: string; site?: string };
      url?: string;
      title?: string;
      reviewDate?: string;
      textualRating?: string;
      languageCode?: string;
    }[];
  }[];
}

const BASE = "https://factchecktools.googleapis.com/v1alpha1/claims:search";

export const googleFactCheck: Connector = {
  id: "google_factcheck",
  label: "Google Fact Check (ClaimReview)",
  required: true,
  appliesTo: () => true,
  unavailableReason: (ctx) => (ctx.config.secrets.googleFactCheckApiKey ? null : "brak klucza GOOGLE_FACT_CHECK_API_KEY"),

  async search(claim, ctx) {
    const key = ctx.config.secrets.googleFactCheckApiKey!;
    const queries: { q: string; lang?: string }[] = [
      ...claim.search_queries_pl.slice(0, 2).map((q) => ({ q, lang: "pl" })),
      ...(claim.search_query_en ? [{ q: claim.search_query_en }] : []),
    ];
    const settled = await Promise.allSettled(
      queries.map(({ q, lang }) => {
        const u = new URL(BASE);
        u.searchParams.set("query", q);
        u.searchParams.set("pageSize", "5");
        if (lang) u.searchParams.set("languageCode", lang);
        u.searchParams.set("key", key);
        return fetchJson(u.toString(), ctx.signal, LIMITS.connectorTimeoutMs) as Promise<ClaimReviewResponse>;
      }),
    );
    const ok = settled.filter((s): s is PromiseFulfilledResult<ClaimReviewResponse> => s.status === "fulfilled");
    // Some queries failed and the rest found nothing: that is not "no fact-check exists" (a required
    // route), so report the failure instead of letting the claim become "brak dowodów".
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    const failure = () => failed?.reason instanceof ConnectorError ? failed.reason : new ConnectorError("error", "all queries failed");
    if (ok.length === 0) throw failure();

    const retrieved = new Date().toISOString();
    const seen = new Set<string>();
    const out: SourceRecord[] = [];
    for (const { value } of ok) {
      for (const c of value.claims ?? []) {
        for (const r of c.claimReview ?? []) {
          if (!r.url || seen.has(r.url)) continue;
          seen.add(r.url);
          const trusted = trustedSourceFor(r.url, ctx.config.trustedSources);
          if (!trusted) continue;
          const publisher = r.publisher?.name || trusted.name;
          // The passage is assembled only from fields of the API response, labelled, so a quote is verifiable.
          const text = [
            `Sprawdzane twierdzenie: "${c.text ?? ""}"`,
            c.claimant ? `Autor twierdzenia: ${c.claimant}.` : "",
            c.claimDate ? `Data twierdzenia: ${c.claimDate.slice(0, 10)}.` : "",
            `Ocena (${publisher}): ${r.textualRating ?? "brak"}.`,
            r.title ? `Tytuł weryfikacji: ${r.title}` : "",
          ].filter(Boolean).join("\n");
          out.push({
            source_id: `gfc:${r.url}`,
            route: "google_factcheck",
            title: r.title || c.text || "Weryfikacja",
            publisher,
            url: r.url,
            published_at: r.reviewDate ?? null,
            retrieved_at: retrieved,
            tier: trusted.tier,
            // One publisher is one origin: two articles by the same newsroom are not independent.
            origin_key: `publisher:${trusted.id}`,
            text,
          });
        }
      }
    }
    // Counted after the allowlist filter: a hit from an unlisted publisher is not evidence either.
    if (failed && out.length === 0) throw failure();
    return enrichWithArticles(out, ctx.signal, ctx.isSwitchedOff, ctx.resolveHost);
  },
};

/**
 * The ClaimReview index holds only the checked statement, the rating and a title. The reasons a
 * fact-checker gives (the real figure and year, the original date of a recording, that a dispatch was
 * still online) are in its article. For the first few fact-check hits, the opening of the article is
 * appended to the passage, so the assessment can quote the fact-checker's own findings.
 * Fetched through the guarded URL intake (robots.txt, SSRF, size and time caps), used for this check
 * only and never stored (hard constraints 13, 14). A failed fetch keeps the index fields alone.
 */
export const ARTICLE_LABEL = "Fragment artykułu weryfikacji:";

/** The fact-check hits whose article is fetched; switched-off publishers never take a slot. */
export function articlePicks(records: SourceRecord[], isSwitchedOff?: (r: SourceRecord) => boolean): SourceRecord[] {
  return records.filter((r) => r.tier === "factcheck" && !isSwitchedOff?.(r)).slice(0, LIMITS.factcheckArticlesPerClaim);
}

async function enrichWithArticles(
  records: SourceRecord[],
  signal: AbortSignal | undefined,
  isSwitchedOff?: (r: SourceRecord) => boolean,
  resolveHost?: (hostname: string) => Promise<string[]>,
): Promise<SourceRecord[]> {
  const picks = articlePicks(records, isSwitchedOff);
  await Promise.all(picks.map(async (r) => {
    try {
      const deadline = AbortSignal.timeout(LIMITS.factcheckArticleTimeoutMs);
      const a = await fetchArticle(r.url, { resolveHost, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
      const excerpt = clipAtSentence(a.text, LIMITS.factcheckArticleChars);
      if (excerpt) r.text = `${r.text}\n${ARTICLE_LABEL}\n${excerpt}`;
    } catch {
      // The index fields alone still carry the rating.
    }
  }));
  return records;
}

function clipAtSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut;
}
