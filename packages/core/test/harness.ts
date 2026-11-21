/**
 * Test harness: replaces global fetch so the pipeline runs with a scripted model and scripted
 * source APIs. Deterministic, free, offline. Every outbound request is recorded, so tests can
 * assert what left the server (PII, URLs, model names).
 *
 * All claims and sources here are synthetic test data (rule 16: never mirror the jury set).
 */
import { loadConfig, MemoryCheckStore, MemoryCorpusStore } from "../src/mod.ts";
import type { CoreDeps } from "../src/pipeline/check.ts";

export interface Call {
  url: URL;
  body: unknown;
  rawBody: string;
}

export type ModelScript = {
  extraction?: (input: { user_message: string; material: { provenance: string; text: string }[] }) => unknown;
  assessment?: (input: { claim: { text: string }; passages: { passage_id: string; text: string; publisher: string }[] }) => unknown;
  image?: () => unknown;
  /** Force an HTTP status for a model step (e.g. 429). Called per request. */
  status?: (schema: string, model: string) => number | undefined;
};

export type SourceScript = {
  googleFactCheck?: (query: string, lang: string | null) => unknown | Response;
  sejmEli?: (title: string) => unknown | Response;
  web?: (url: URL) => Response | undefined;
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function llm(content: unknown, model: string): Response {
  return json({
    model,
    provider: "Mistral",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: { cost: 0.0001, prompt_tokens: 100, completion_tokens: 50 },
  });
}

/** Installs the stub. Always call restore() (use try/finally). */
export function stubFetch(model: ModelScript, sources: SourceScript = {}) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const rawBody = typeof init?.body === "string" ? init.body : "";
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch { /* not JSON */ }
    calls.push({ url, body, rawBody });

    if (url.hostname === "openrouter.ai") {
      const b = body as { model: string; response_format: { json_schema: { name: string } }; messages: { content: unknown }[] };
      const schema = b.response_format.json_schema.name;
      const forced = model.status?.(schema, b.model);
      if (forced) return json({ error: { message: "forced" } }, forced);
      const userContent = b.messages[1].content;
      const input = typeof userContent === "string" ? JSON.parse(userContent) : null;
      if (schema === "claim_extraction" && model.extraction) return llm(model.extraction(input), b.model);
      if (schema === "evidence_assessment" && model.assessment) return llm(model.assessment(input), b.model);
      if (schema === "image_extraction" && model.image) return llm(model.image(), b.model);
      return json({ error: { message: `no script for ${schema}` } }, 500);
    }
    if (url.hostname === "factchecktools.googleapis.com") {
      const r = sources.googleFactCheck?.(url.searchParams.get("query") ?? "", url.searchParams.get("languageCode"));
      return r instanceof Response ? r : json(r ?? {});
    }
    if (url.hostname === "api.sejm.gov.pl") {
      const r = sources.sejmEli?.(url.searchParams.get("title") ?? "");
      return r instanceof Response ? r : json(r ?? { count: 0, items: [] });
    }
    const page = sources.web?.(url);
    if (page) return page;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export function deps(keys: { openrouter?: boolean; google?: boolean } = { openrouter: true, google: true }): CoreDeps & {
  store: MemoryCheckStore;
} {
  const env: Record<string, string> = {};
  if (keys.openrouter) env.OPENROUTER_API_KEY = "test-key";
  if (keys.google) env.GOOGLE_FACT_CHECK_API_KEY = "test-key";
  return {
    config: loadConfig({ get: (k) => env[k] }),
    store: new MemoryCheckStore(),
    corpus: new MemoryCorpusStore(),
    resolveHost: () => Promise.resolve(["93.184.215.14"]),
  };
}

// ── builders for scripted model output ───────────────────────────────────────
export interface ClaimSpec {
  text: string;
  span?: string;
  class?: "fact" | "opinion" | "prediction";
  type?: string | null;
  risk?: "high" | "normal";
  time?: string;
}

export function extraction(claims: ClaimSpec[], extra: Record<string, unknown> = {}) {
  return {
    input_kind: claims.some((c) => (c.class ?? "fact") === "fact") ? "checkable" : "opinion_only",
    claims: claims.map((c, i) => ({
      id: `c${i + 1}`,
      text: c.text,
      source_span: c.span ?? c.text,
      provenance: "text",
      class: c.class ?? "fact",
      type: (c.class ?? "fact") === "fact" ? (c.type === undefined ? "event" : c.type) : null,
      time: c.time ?? "2025",
      place: null,
      entities: [],
      search_queries_pl: (c.class ?? "fact") === "fact" ? ["zapytanie testowe"] : [],
      search_query_en: (c.class ?? "fact") === "fact" ? "test query" : "",
      risk: c.risk ?? "normal",
      ambiguities: [],
      why_not_verifiable: (c.class ?? "fact") === "fact" ? null : "To opinia.",
    })),
    implied_warnings: [],
    clarification_question: null,
    injection_signals: [],
    skipped_rhetorical: 0,
    ...extra,
  };
}

/** Assessment where each passage gets a stance; the quote is the passage's line containing `quoteNeedle`. */
export function assess(
  stances: Record<string, { stance: string; needle?: string; quote?: string }>,
  proposed: string,
  extra: Record<string, unknown> = {},
) {
  return (input: { passages: { passage_id: string; text: string; publisher: string }[] }) => ({
    passages: input.passages.map((p) => {
      const s = Object.entries(stances).find(([pub]) => p.publisher.includes(pub))?.[1] ?? { stance: "irrelevant" };
      const line = s.quote ?? (s.needle ? p.text.split("\n").find((l) => l.includes(s.needle!)) ?? "" : "");
      return { passage_id: p.passage_id, stance: s.stance, quote: s.stance === "irrelevant" ? "" : line, difference: s.stance === "misleading" ? "inny rok" : null, data_period: null };
    }),
    proposed_verdict: proposed,
    explanation: "Wyjaśnienie modelu.",
    missing: null,
    injection_signals: [],
    ...extra,
  });
}

export function factCheck(publisher: string, rating: string, claimText: string, url = `https://fc.example/${encodeURIComponent(publisher)}`) {
  return {
    claims: [{
      text: claimText,
      claimant: "Internet",
      claimDate: "2025-03-01T00:00:00Z",
      claimReview: [{ publisher: { name: publisher, site: `${publisher.toLowerCase()}.example` }, url, title: `Weryfikacja: ${claimText}`, reviewDate: "2025-03-05T00:00:00Z", textualRating: rating, languageCode: "pl" }],
    }],
  };
}

export function eliAct(title: string, address = "WDU20240000001", entryIntoForce = "2025-01-01") {
  return {
    count: 1,
    items: [{ address, displayAddress: "Dz.U. 2024 poz. 1", title, type: "Ustawa", status: "obowiązujący", inForce: "IN_FORCE", announcementDate: "2024-12-05", promulgation: "2024-12-10", entryIntoForce }],
  };
}

export const T = { sanitizeOps: false, sanitizeResources: false };
