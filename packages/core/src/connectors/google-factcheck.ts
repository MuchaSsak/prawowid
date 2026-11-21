/**
 * Google Fact Check Tools API (ClaimReview from Demagog, AFP Sprawdzam, Konkret24, …).
 * Verified endpoint: architecture/api-endpoints-verified.md. Needs GOOGLE_FACT_CHECK_API_KEY with the
 * "Fact Check Tools API" enabled in the Google Cloud project.
 * Only publishers on the trusted-source allowlist (sources/catalog.ts) are kept; the catalog sets the tier.
 */
import { LIMITS } from "../config.ts";
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
    if (ok.length === 0) {
      const first = settled[0] as PromiseRejectedResult | undefined;
      throw first?.reason instanceof ConnectorError ? first.reason : new ConnectorError("error", "all queries failed");
    }

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
    return out;
  },
};
