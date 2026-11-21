/**
 * The verification core: one entry point every channel calls (hard constraint 18).
 * Flow: validate → intake (text | url | image) → guard (PII, injection) → cache → extract →
 * per claim in parallel: retrieve → assess → code verdict → render → log.
 */
import { type Config, LIMITS } from "../config.ts";
import { CONNECTORS, NOT_YET_COVERED } from "../connectors/mod.ts";
import type { ConnectorContext } from "../connectors/types.ts";
import { scanInjection } from "../guard/injection.ts";
import { normalizeForMatch, sha256Hex } from "../guard/normalize.ts";
import { maskPii } from "../guard/pii.ts";
import { extractImage } from "../intake/image.ts";
import { fetchArticle, IntakeError, type ResolveHost } from "../intake/url.ts";
import { LlmError, type LlmUsage } from "../llm/openrouter.ts";
import { CLAIM_EXTRACTION_ID } from "../prompts/claim-extraction.v1.ts";
import { EVIDENCE_ASSESSMENT_ID } from "../prompts/evidence-assessment.v1.ts";
import type { CheckEventRow, CheckStore, CorpusStore } from "../store/types.ts";
import {
  type CheckRequest,
  type CheckResponse,
  type Citation,
  type ClaimResult,
  CONTRACT_VERSION,
  type RequestStatus,
  VERDICT_LABEL_PL,
  type Warning,
} from "../types.ts";
import { assessClaim } from "./assess.ts";
import { type ExtractedClaim, extractClaims, type Material } from "./extract.ts";
import {
  BASE_LIMITATIONS,
  claimStateMessage,
  requestMessage,
  summaryText,
  templateExplanation,
} from "./render.ts";
import { retrieve } from "./retrieve.ts";
import { decideVerdict } from "./verdict.ts";

export interface CoreDeps {
  config: Config;
  store: CheckStore;
  corpus: CorpusStore;
  resolveHost?: ResolveHost;
  now?: () => Date;
}

function llmMessage(err: unknown): string {
  if (err instanceof LlmError) {
    switch (err.kind) {
      case "missing_key":
        return "Usługa nie jest skonfigurowana (brak klucza OPENROUTER_API_KEY).";
      case "timeout":
        return "Model językowy nie odpowiedział na czas.";
      case "rate_limited":
        return "Przekroczono limit zapytań do modelu językowego.";
      case "invalid_output":
        return "Model zwrócił nieprawidłową odpowiedź.";
      default:
        return "Usługa modelu językowego zwróciła błąd.";
    }
  }
  return "Nieoczekiwany błąd.";
}

/** Confirmed vs false/misleading: the two readings cannot both be right. */
function opposite(a: string, b: string): boolean {
  const neg = (v: string) => v === "false" || v === "misleading";
  return (a === "confirmed" && neg(b)) || (b === "confirmed" && neg(a));
}

export async function runCheck(req: CheckRequest, deps: CoreDeps): Promise<CheckResponse> {
  const started = Date.now();
  const now = deps.now?.() ?? new Date();
  const check_id = crypto.randomUUID();
  const stages: Record<string, number> = {};
  const mark = (name: string, t0: number) => (stages[name] = Date.now() - t0);
  const usages: LlmUsage[] = [];
  const prompts = new Set<string>();
  const events: CheckEventRow[] = [];
  const event = (type: CheckEventRow["type"], detail: Record<string, unknown>) =>
    events.push({ check_id, type, detail, created_at: new Date().toISOString() });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), LIMITS.requestDeadlineMs);
  const sessionHash = req.session_id ? await sha256Hex(`session:${req.session_id}`) : null;
  const inputType = req.input?.type;

  const response: CheckResponse = {
    contract_version: CONTRACT_VERSION,
    check_id,
    status: "ok",
    answer_language: "pl",
    system_message: null,
    summary: { fact_claims: 0, opinions: 0, text: "" },
    claims: [],
    warnings: [],
    limitations: [...BASE_LIMITATIONS, NOT_YET_COVERED],
    escalation: { state: "none", reason: null },
    input: { type: inputType ?? "text", title: null, url: null, published_at: null, description: null },
    meta: { latency_ms: 0, stages_ms: stages, models: [], prompt_versions: [], cost_usd: 0, cached: false, mode: "live" },
  };
  let maskedForLog = "";
  let cachedFrom: CheckResponse | null = null;

  const finish = async (status: RequestStatus, detail?: string | null): Promise<CheckResponse> => {
    clearTimeout(timer);
    response.status = status;
    response.system_message = response.system_message ?? requestMessage(status, detail);
    response.meta.latency_ms = Date.now() - started;
    response.meta.cached = cachedFrom !== null;
    response.meta.models = cachedFrom?.meta.models ?? [...new Set(usages.map((u) => u.model))];
    response.meta.prompt_versions = cachedFrom?.meta.prompt_versions ?? [...prompts];
    response.meta.cost_usd = Number(usages.reduce((s, u) => s + u.cost_usd, 0).toFixed(6));
    try {
      await deps.store.saveCheck({
        check_id,
        session_hash: sessionHash,
        channel: req.channel ?? "api",
        input_type: response.input.type,
        masked_input: maskedForLog.slice(0, 1000),
        status,
        claims: response.claims.map((c) => ({
          id: c.id,
          verdict: c.verdict,
          system_state: c.system_state,
          source_ids: c.citations.map((x) => x.source_id),
        })),
        latency_ms: response.meta.latency_ms,
        models: response.meta.models,
        prompt_versions: response.meta.prompt_versions,
        cost_usd: response.meta.cost_usd,
        created_at: now.toISOString(),
      });
      for (const e of events) await deps.store.logEvent(e);
    } catch {
      // Logging must never change the user's answer.
    }
    return response;
  };

  // ── 1. Validate ────────────────────────────────────────────────────────────
  const value = typeof req.input?.value === "string" ? req.input.value : "";
  const userMessageRaw = (req.user_message ?? "").slice(0, 2000);
  if (!["text", "url", "image"].includes(inputType) || !value.trim()) {
    return finish("input_rejected", "Wklej tekst, link albo dodaj obraz.");
  }
  if (inputType === "text" && value.length > 50_000) {
    return finish("input_rejected", "Tekst jest za długi (maks. 50 000 znaków). Wklej najważniejszy fragment.");
  }

  // ── 2. Intake ──────────────────────────────────────────────────────────────
  let material: Material[] = [];
  const tIntake = Date.now();
  try {
    if (inputType === "text") {
      const truncated = value.length > LIMITS.maxMaterialChars;
      material = [{ provenance: "text", text: value.slice(0, LIMITS.maxMaterialChars) }];
      if (truncated) {
        response.warnings.push({ type: "partial_analysis", text: `Przeanalizowaliśmy pierwsze ${LIMITS.maxMaterialChars} znaków tekstu.` });
      }
    } else if (inputType === "url") {
      const a = await fetchArticle(value, { resolveHost: deps.resolveHost, signal: deadline.signal });
      material = [{ provenance: "article", text: a.text }];
      response.input = { ...response.input, title: a.title, url: a.url, published_at: a.published_at };
      if (a.truncated) {
        response.warnings.push({ type: "partial_analysis", text: `Artykuł jest długi: przeanalizowaliśmy pierwsze ${LIMITS.maxMaterialChars} znaków.` });
      }
    } else {
      const img = await extractImage(value, {
        apiKey: deps.config.secrets.openrouterApiKey,
        model: deps.config.models.image_extraction,
        signal: deadline.signal,
      });
      usages.push(img.usage);
      prompts.add(img.prompt);
      response.input.description = img.data.description;
      for (const s of img.data.injection_signals) event("injection_detected", { provenance: "image#1", excerpt: s.slice(0, 200) });
      if (img.data.legibility !== "good") {
        response.warnings.push({ type: "illegible_media", text: "Nie udało się odczytać obrazu w całości; część tekstu może być pominięta." });
      }
      const dates = img.data.visible_dates.length ? `\n[Daty widoczne na obrazie: ${img.data.visible_dates.join(", ")}]` : "";
      material = img.data.ocr_text.trim() ? [{ provenance: "image#1", text: img.data.ocr_text + dates }] : [];
      if (!material.length && !userMessageRaw.trim()) {
        mark("intake", tIntake);
        return finish(
          "needs_clarification",
          "Na obrazie nie ma tekstu do sprawdzenia. Dopisz, co dokładnie mamy zweryfikować (np. gdzie i kiedy zrobiono zdjęcie).",
        );
      }
    }
  } catch (err) {
    mark("intake", tIntake);
    if (err instanceof IntakeError) {
      event("intake_error", { kind: err.kind });
      const technical = err.kind === "fetch_failed" || err.kind === "timeout";
      return finish(technical ? "technical_error" : "input_rejected", err.message);
    }
    event("llm_error", { stage: "image", message: (err as Error).message.slice(0, 300) });
    return finish("technical_error", `Nie udało się odczytać obrazu. ${llmMessage(err)}`);
  }
  mark("intake", tIntake);

  // ── 3. Guard: PII mask, injection scan ─────────────────────────────────────
  let redacted = 0;
  material = material.map((m) => {
    const { text, redactions } = maskPii(m.text);
    redacted += redactions.reduce((s, r) => s + r.count, 0);
    return { ...m, text };
  });
  const um = maskPii(userMessageRaw);
  redacted += um.redactions.reduce((s, r) => s + r.count, 0);
  const userMessage = um.text;
  if (redacted) event("pii_redacted", { count: redacted });
  maskedForLog = [userMessage, ...material.map((m) => m.text)].filter(Boolean).join("\n---\n");

  const injections = [
    ...scanInjection(userMessage, "user_message"),
    ...material.flatMap((m) => scanInjection(m.text, m.provenance)),
  ];
  for (const s of injections) event("injection_detected", { ...s });

  // ── 4. Cache (same canonical result across channels for 5 minutes, scenario G) ─
  const today = now.toISOString().slice(0, 10);
  const cacheKey = await sha256Hex(
    JSON.stringify([inputType, today, normalizeForMatch(userMessage), material.map((m) => normalizeForMatch(m.text))]),
  );
  const cached = await deps.store.getCached(cacheKey);
  if (cached) {
    cachedFrom = cached;
    const c = structuredClone(cached);
    Object.assign(response, {
      claims: c.claims,
      summary: c.summary,
      warnings: c.warnings,
      limitations: c.limitations,
      escalation: c.escalation,
      input: c.input,
      system_message: c.system_message,
    });
    await deps.store.setCached(cacheKey, cached, sessionHash);
    return finish(cached.status, null);
  }

  // ── 5. Extract claims (LLM #1) ─────────────────────────────────────────────
  const tExtract = Date.now();
  let extracted;
  try {
    extracted = await extractClaims({
      material,
      userMessage,
      today,
      publishedAt: response.input.published_at,
      apiKey: deps.config.secrets.openrouterApiKey,
      model: deps.config.models.claim_extraction,
      signal: deadline.signal,
    });
    usages.push(extracted.usage);
    prompts.add(CLAIM_EXTRACTION_ID);
  } catch (err) {
    mark("extract", tExtract);
    event("llm_error", { stage: "extract", message: (err as Error).message.slice(0, 300) });
    return finish("technical_error", llmMessage(err));
  }
  mark("extract", tExtract);
  const { extraction } = extracted;
  for (const s of extracted.rejectedSpans) event("span_rejected", { span: s });
  for (const s of extraction.injection_signals) event("injection_detected", { ...s, by: "model" });
  if (injections.length || extraction.injection_signals.length) {
    response.warnings.push({
      type: "injection_detected",
      text: "Materiał zawiera polecenia skierowane do systemów AI. Zignorowaliśmy je i oceniliśmy tylko fakty.",
    });
  }
  if (extracted.capped) {
    response.warnings.push({
      type: "partial_analysis",
      text: `Tekst zawiera więcej twierdzeń, niż sprawdzamy naraz; wybraliśmy ${LIMITS.maxFactClaims} najważniejszych.`,
    });
  }
  for (const w of extraction.implied_warnings) response.warnings.push({ type: "implied_claim", text: w });

  if (extraction.input_kind === "too_vague" || (extraction.input_kind !== "checkable" && extraction.claims.length === 0)) {
    const map: Record<string, RequestStatus> = {
      too_vague: "needs_clarification",
      out_of_scope: "out_of_scope",
      joke_or_nonsense: "not_a_claim",
      opinion_only: "not_a_claim",
      checkable: "not_a_claim",
    };
    return finish(map[extraction.input_kind], extraction.clarification_question);
  }

  // ── 6. Evidence per claim, in parallel ─────────────────────────────────────
  const ctx: ConnectorContext = { config: deps.config, signal: deadline.signal, corpus: deps.corpus };
  const tEvidence = Date.now();
  const claimResults = await Promise.all(extraction.claims.map((c) => checkOne(c)));
  mark("evidence", tEvidence);

  async function checkOne(c: ExtractedClaim): Promise<ClaimResult> {
    const base: ClaimResult = {
      id: c.id,
      text: c.text,
      provenance: c.provenance,
      class: c.class,
      type: c.type,
      time: c.time,
      risk: c.risk,
      verdict: null,
      verdict_label: null,
      system_state: null,
      system_message: null,
      strength: null,
      explanation: "",
      missing: null,
      citations: [],
      warnings: c.ambiguities.map((a): Warning => ({ type: "partial_analysis", text: a })),
      routes: [],
    };
    if (c.class !== "fact") {
      return {
        ...base,
        verdict: "not_verifiable",
        verdict_label: VERDICT_LABEL_PL.not_verifiable,
        explanation: c.why_not_verifiable || templateExplanation("not_verifiable", []),
      };
    }
    if (c.time === "unknown") {
      base.warnings.push({ type: "assumed_period", text: "Twierdzenie nie podaje daty; porównujemy je z najnowszymi dostępnymi informacjami." });
    }

    const query = {
      text: c.text,
      type: c.type,
      time: c.time,
      entities: c.entities,
      search_queries_pl: c.search_queries_pl.length ? c.search_queries_pl : [c.text],
      search_query_en: c.search_query_en,
    };
    const r = await retrieve(query, CONNECTORS, ctx);
    base.routes = r.routes;
    for (const route of r.routes) {
      if (["error", "timeout", "unavailable"].includes(route.status)) event("route_error", { claim: c.id, ...route });
    }
    if (r.requiredFailure) {
      const state = r.requiredFailure.status === "unavailable" ? "source_unavailable" : "technical_error";
      return { ...base, system_state: state, system_message: claimStateMessage(state, `${r.requiredFailure.label}: ${r.requiredFailure.detail ?? r.requiredFailure.status}`) };
    }
    const optionalRouteMissing = r.routes.some((x) => !x.required && x.status !== "hits" && x.status !== "no_hits");

    if (r.records.length === 0) {
      return {
        ...base,
        verdict: "insufficient_evidence",
        verdict_label: VERDICT_LABEL_PL.insufficient_evidence,
        strength: { level: "low", reasons: ["brak pasujących źródeł"] },
        explanation: templateExplanation("insufficient_evidence", []),
        missing: "W przeszukanych źródłach nie ma informacji o tym twierdzeniu.",
      };
    }
    if (deadline.signal.aborted) {
      return { ...base, system_state: "not_processed", system_message: claimStateMessage("not_processed") };
    }

    let assessed;
    try {
      assessed = await assessClaim({
        claim: { text: c.text, time: c.time, place: c.place },
        records: r.records,
        apiKey: deps.config.secrets.openrouterApiKey,
        model: deps.config.models.evidence_assessment,
        signal: deadline.signal,
      });
      usages.push(assessed.usage);
      prompts.add(EVIDENCE_ASSESSMENT_ID);
    } catch (err) {
      event("llm_error", { stage: "assess", claim: c.id, message: (err as Error).message.slice(0, 300) });
      if (deadline.signal.aborted) {
        return { ...base, system_state: "not_processed", system_message: claimStateMessage("not_processed") };
      }
      return { ...base, system_state: "technical_error", system_message: claimStateMessage("technical_error", llmMessage(err)) };
    }
    for (const p of assessed.passages) {
      if (p.quoteRejected) event("quote_rejected", { claim: c.id, source_id: p.record.source_id, stance: p.modelStance });
    }
    for (const s of assessed.assessment.injection_signals) event("injection_detected", { claim: c.id, ...s, by: "model" });

    const d = decideVerdict(assessed.passages, { optionalRouteMissing });
    const proposed = assessed.assessment.proposed_verdict;
    let explanation = assessed.assessment.explanation;
    let missingOverride: string | null = null;
    if (proposed !== d.verdict) {
      event("verdict_disagreement", { claim: c.id, code: d.verdict, model: proposed, rule: d.rule });
      explanation = templateExplanation(d.verdict, d.decisive);
      // Pipeline §4: an inconsistent assessment (passage labels point one way, the model's own
      // reading the opposite way) is not eligible for a factual verdict.
      if (opposite(d.verdict, proposed)) {
        d.verdict = "insufficient_evidence";
        d.strength = { level: "low", reasons: ["ocena źródeł była niespójna"] };
        explanation = templateExplanation("insufficient_evidence", []);
        missingOverride = "Ocena źródeł była niejednoznaczna. Sprawdź cytowane źródła samodzielnie.";
      }
    }
    const order = new Map(d.decisive.map((p, i) => [p.record.source_id, i]));
    const citations: Citation[] = assessed.passages
      .filter((p) => p.stance !== "irrelevant")
      .sort((a, b) => (order.get(a.record.source_id) ?? 99) - (order.get(b.record.source_id) ?? 99))
      .map((p) => ({
        source_id: p.record.source_id,
        title: p.record.title,
        publisher: p.record.publisher,
        published_at: p.record.published_at,
        retrieved_at: p.record.retrieved_at,
        url: p.record.url,
        excerpt: p.quote,
        stance: p.stance as Citation["stance"],
        tier: p.record.tier,
        route: p.record.route,
      }));
    return {
      ...base,
      verdict: d.verdict,
      verdict_label: VERDICT_LABEL_PL[d.verdict],
      strength: d.strength,
      explanation,
      missing: d.verdict === "insufficient_evidence"
        ? missingOverride ?? assessed.assessment.missing ?? "Nie znaleźliśmy źródła, które jednoznacznie to rozstrzyga."
        : null,
      citations,
      warnings: [...base.warnings, ...d.warnings],
    };
  }

  // ── 7. Assemble ────────────────────────────────────────────────────────────
  response.claims = claimResults;
  const facts = claimResults.filter((c) => c.class === "fact");
  const opinions = claimResults.length - facts.length;
  response.summary = { fact_claims: facts.length, opinions, text: summaryText(facts.length, opinions) };
  const highRiskAbstain = facts.find((c) => c.risk === "high" && c.verdict === "insufficient_evidence");
  if (highRiskAbstain) {
    response.escalation = {
      state: "recommended",
      reason: "Rekomendujemy przekazanie do weryfikacji przez człowieka: twierdzenie dotyczy bezpieczeństwa, a dowodów brakuje.",
    };
  }
  const failed = claimResults.filter((c) => c.system_state);
  let status: RequestStatus = failed.length ? "partial" : "ok";
  if (failed.length && failed.length === claimResults.length) {
    status = "technical_error";
    response.system_message = {
      title: "Nie udało się zakończyć sprawdzania",
      text: "Żadnego twierdzenia nie udało się sprawdzić z powodów technicznych (szczegóły przy twierdzeniach). To nie jest ocena treści.",
    };
  }
  const result = await finish(status, null);
  if (status === "ok" || status === "partial") await deps.store.setCached(cacheKey, structuredClone(result), sessionHash);
  return result;
}
