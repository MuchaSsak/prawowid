/**
 * The verification core: one entry point every channel calls (hard constraint 18).
 * Flow: validate → intake (text | url | image | video | audio) → guard (PII, injection) → cache → extract →
 * per claim in parallel: retrieve → assess → code verdict → render → log.
 */
import { type Config, LIMITS } from "../config.ts";
import { CONNECTORS, NOT_YET_COVERED } from "../connectors/mod.ts";
import type { Connector, ConnectorContext } from "../connectors/types.ts";
import { scanInjection } from "../guard/injection.ts";
import { normalizeForMatch, sha256Hex } from "../guard/normalize.ts";
import { maskPii } from "../guard/pii.ts";
import { extractImage } from "../intake/image.ts";
import { isMediaType, mediaInputError } from "../intake/media.ts";
import { transcribeRecording, transcriptToMaterial } from "../intake/recording.ts";
import { fetchArticle, IntakeError, type ResolveHost } from "../intake/url.ts";
import { LlmError, type LlmUsage } from "../llm/openrouter.ts";
import { CLAIM_EXTRACTION_ID } from "../prompts/claim-extraction.v7.ts";
import { EVIDENCE_ASSESSMENT_ID } from "../prompts/evidence-assessment.v7.ts";
import type { CheckEventRow, CheckStore, CorpusStore } from "../store/types.ts";
import {
  type CheckRequest,
  type CheckResponse,
  type Citation,
  type ClaimResult,
  CONTRACT_VERSION,
  INPUT_TYPES,
  MESSAGING_PLATFORMS,
  type RequestStatus,
  VERDICT_LABEL_PL,
  type Warning,
} from "../types.ts";
import { assessClaim } from "./assess.ts";
import { periodNote, referenceDate, resolveTime } from "./dates.ts";
import { type ExtractedClaim, extractClaims, type Material } from "./extract.ts";
import {
  announcedPassedExplanation,
  announcementExplanation,
  askedCheckerAnswer,
  factcheckExplanation,
  plainFromVerdict,
  BASE_LIMITATIONS,
  isQuestion,
  leadWord,
  claimStateMessage,
  requestMessage,
  summaryText,
  templateExplanation,
  ratedPartlyTrue,
  withAbsenceNote,
  withLead,
} from "./render.ts";
import { numericGuard } from "./numeric.ts";
import { retrieve } from "./retrieve.ts";
import { type ContextResult, findContextMatches, NARRATIVE_MATCHERS } from "../narratives/mod.ts";
import type { KnownIncidentStore, NarrativeMatcher } from "../narratives/types.ts";
import { decideVerdict } from "./verdict.ts";
import { SOURCE_DISABLED_DETAIL } from "../sources/controls.ts";

export interface CoreDeps {
  config: Config;
  store: CheckStore;
  corpus: CorpusStore;
  /** Known-incident index (EUvsDisinfo cases). Optional: without it the live EUvsDisinfo search is used. */
  incidents?: KnownIncidentStore;
  resolveHost?: ResolveHost;
  now?: () => Date;
  /**
   * Evidence routes for this deployment. Default: CONNECTORS (connectors/mod.ts). A new source plugs
   * in here, from any adapter, without touching the pipeline (architecture/extensibility.md).
   */
  connectors?: Connector[];
  /** Known-incident matchers (context, never evidence). Default: NARRATIVE_MATCHERS. */
  narrativeMatchers?: NarrativeMatcher[];
  /**
   * Extra part of the result cache key, e.g. the source-controls revision (sources/controls.ts), so an
   * answer cached before an operator switched a source off is never served after it.
   */
  cacheScope?: string;
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
      case "payment":
        return "Konto usługi modelu nie ma wystarczających środków na tę analizę.";
      case "invalid_output":
        return "Model zwrócił nieprawidłową odpowiedź.";
      default:
        return "Usługa modelu językowego zwróciła błąd.";
    }
  }
  return "Nieoczekiwany błąd.";
}

/** Known-incident context goes next to the result: its routes, one warning, the matches. Never into citations. */
function addContext(x: ClaimResult, known: ContextResult): ClaimResult {
  return {
    ...x,
    routes: [...x.routes, ...known.routes],
    warnings: [...x.warnings, ...known.warnings],
    ...(known.matches.length ? { context_matches: known.matches } : {}),
  };
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
  const sessionHash = req.session_id ? await sha256Hex(`session:${req.session_id}`) : null;
  const inputType = req.input?.type;
  const isRecording = inputType === "video" || inputType === "audio";
  const timer = setTimeout(() => deadline.abort(), isRecording ? LIMITS.recordingRequestDeadlineMs : LIMITS.requestDeadlineMs);

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
        ...((MESSAGING_PLATFORMS as readonly unknown[]).includes(req.platform) ? { platform: req.platform } : {}),
        input_type: response.input.type,
        masked_input: maskedForLog.slice(0, 1000),
        status,
        claims: response.claims.map((c) => ({
          id: c.id,
          verdict: c.verdict,
          system_state: c.system_state,
          source_ids: c.citations.map((x) => x.source_id),
          text: c.text.slice(0, 300),
          type: c.type,
          class: c.class,
          context_match: (c.context_matches?.length ?? 0) > 0,
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
  // Optional fields arrive unchecked from the HTTP body: a non-string must not throw (HTTP 500).
  const userMessageRaw = (typeof req.user_message === "string" ? req.user_message : "").slice(0, 2000);
  if (!(INPUT_TYPES as readonly string[]).includes(inputType) || !value.trim()) {
    return finish("input_rejected", "Wklej tekst, link albo dodaj obraz, wideo lub nagranie audio.");
  }
  if (isMediaType(inputType)) {
    const bad = mediaInputError(inputType, value);
    if (bad) return finish("input_rejected", bad);
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
      // A chat message often carries a link ("sprawdź też tę stronę: …"). The linked page is read as
      // material through the same guarded fetch (SSRF, robots.txt, size); any instruction inside it
      // is data and is caught by the injection scan below. A failed fetch never blocks the text.
      const link = value.match(/https?:\/\/[^\s<>"'\])]+/)?.[0]?.replace(/[.,;:!?]+$/, "");
      if (link) {
        try {
          const a = await fetchArticle(link, { resolveHost: deps.resolveHost, signal: deadline.signal });
          material.push({ provenance: "article", text: a.text });
          response.input = { ...response.input, title: a.title, url: a.url, published_at: a.published_at };
        } catch (err) {
          event("intake_error", { kind: err instanceof IntakeError ? err.kind : "error", from: "link_in_text" });
          response.warnings.push({
            type: "partial_analysis",
            text: `Nie udało się odczytać strony z linku${err instanceof IntakeError ? ` (${err.message})` : ""}. Sprawdziliśmy tylko treść wiadomości.`,
          });
        }
      }
    } else if (inputType === "url") {
      const a = await fetchArticle(value, { resolveHost: deps.resolveHost, signal: deadline.signal });
      material = [{ provenance: "article", text: a.text }];
      response.input = { ...response.input, title: a.title, url: a.url, published_at: a.published_at };
      if (a.truncated) {
        response.warnings.push({ type: "partial_analysis", text: `Artykuł jest długi: przeanalizowaliśmy pierwsze ${LIMITS.maxMaterialChars} znaków.` });
      }
    } else if (inputType === "video" || inputType === "audio") {
      const rec = await transcribeRecording(inputType, value, {
        apiKey: deps.config.secrets.openrouterApiKey,
        models: deps.config.models,
        signal: deadline.signal,
      });
      usages.push(rec.usage);
      prompts.add(rec.prompt);
      const t = rec.data;
      for (const s of t.injection_signals) event("injection_detected", { provenance: inputType, excerpt: s.slice(0, 200) });
      response.input.description = t.visual_summary.trim() || null;
      if (t.audibility !== "good") {
        response.warnings.push({ type: "illegible_media", text: "Część nagrania była niewyraźna; niektóre wypowiedzi mogły zostać pominięte." });
      }
      response.limitations.push("Sprawdzamy to, co zostało powiedziane lub pokazane w nagraniu. Nie oceniamy, czy nagranie jest autentyczne ani czy nie zostało zmontowane.");
      if (rec.nonEea) {
        response.limitations.push("To nagranie zostało przetworzone przez model Google poza Europejskim Obszarem Gospodarczym (bez przechowywania danych).");
      }
      const m = transcriptToMaterial(inputType, t);
      material = m.material;
      if (m.truncated) {
        response.warnings.push({ type: "partial_analysis", text: "Nagranie jest długie: przeanalizowaliśmy jego początek." });
      }
      if (!material.length && !userMessageRaw.trim()) {
        mark("intake", tIntake);
        return finish(
          "needs_clarification",
          inputType === "video"
            ? "W nagraniu nie ma wypowiedzi ani tekstu do sprawdzenia. Dopisz, co dokładnie mamy zweryfikować."
            : "W nagraniu nie ma wypowiedzi do sprawdzenia. Nagraj je ponownie albo wpisz twierdzenie tekstem.",
        );
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
      if (img.data.visible_dates.length) {
        response.limitations.push("Data widoczna na obrazie nie potwierdza sama w sobie, kiedy materiał naprawdę opublikowano.");
      }
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
    const what = inputType === "video" ? "nagrania wideo" : inputType === "audio" ? "nagrania audio" : "obrazu";
    event("llm_error", { stage: isRecording ? inputType : "image", message: (err as Error).message.slice(0, 300) });
    return finish("technical_error", `Nie udało się odczytać ${what}. ${llmMessage(err)}`);
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
  // A question gets "Tak."/"Nie.", a pasted statement "To prawda."/"To nieprawda." (render.ts leadWord).
  const asksQuestion = isQuestion(userMessage) || (inputType === "text" && isQuestion(material[0]?.text ?? ""));

  const injections = [
    ...scanInjection(userMessage, "user_message"),
    ...material.flatMap((m) => scanInjection(m.text, m.provenance)),
  ];
  for (const s of injections) event("injection_detected", { ...s });

  // ── 4. Cache (same canonical result across channels for 5 minutes, scenario G) ─
  const today = now.toISOString().slice(0, 10);
  const cacheKey = await sha256Hex(
    JSON.stringify([
      inputType,
      today,
      normalizeForMatch(userMessage),
      material.map((m) => normalizeForMatch(m.text)),
      // Same article text at another URL or date is another input: its link and reference date differ.
      response.input.url,
      response.input.published_at,
      ...(deps.cacheScope ? [deps.cacheScope] : []),
    ]),
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

  // ── 5. Reference date for dates without a year (pipeline §2): publication date of the material,
  //       else the original found in the corpus, else the submission date. Never asked of the user.
  const ref = await referenceDate({
    publishedAt: response.input.published_at,
    texts: material.map((m) => m.text),
    corpus: deps.corpus,
    today,
  });

  // ── 6. Extract claims (LLM #1) ─────────────────────────────────────────────
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
    // No fact at all ("opinion only", "joke or nonsense", "too vague") is where the small model errs:
    // it files conspiracy-style factual claims as opinions, and asks "which strike?" about a named
    // place and event typed without Polish letters ("czy w hiszpanii odbyl sie strajk", 2026-11-22).
    // The stronger model checks that call once; its answer wins only when it finds a fact claim.
    // Costs one extra call on such inputs; a genuinely vague one still gets the clarification question.
    const strong = deps.config.models.evidence_assessment;
    const kind = extracted.extraction.input_kind;
    const hasFact = extracted.extraction.claims.some((x) => x.class === "fact");
    if (!hasFact && (kind === "opinion_only" || kind === "joke_or_nonsense" || kind === "too_vague") && strong !== deps.config.models.claim_extraction) {
      try {
        const second = await extractClaims({
          material, userMessage, today, publishedAt: response.input.published_at,
          apiKey: deps.config.secrets.openrouterApiKey, model: strong, signal: deadline.signal,
        });
        usages.push(second.usage);
        if (second.extraction.claims.some((x) => x.class === "fact")) {
          event("extraction_escalated", { from: kind, to: second.extraction.input_kind });
          extracted = second;
        }
      } catch { /* keep the first extraction */ }
    }
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

  if (extraction.input_kind === "checkable" && extraction.claims.length === 0) {
    // The model said there is something to check, but no claim survived validation (e.g. a span that
    // is not verbatim): our failure, a system state, never "nothing to check" (hard constraint 8).
    return finish("technical_error", "Nie udało się dosłownie wskazać twierdzeń w tym tekście. Wklej samo zdanie, które chcesz sprawdzić.");
  }
  if (extraction.input_kind === "too_vague" || extraction.claims.length === 0) {
    const map: Record<string, RequestStatus> = {
      too_vague: "needs_clarification",
      out_of_scope: "out_of_scope",
      joke_or_nonsense: "not_a_claim",
      opinion_only: "not_a_claim",
    };
    return finish(map[extraction.input_kind] ?? "not_a_claim", extraction.clarification_question);
  }

  // ── 7. Evidence per claim, in parallel ─────────────────────────────────────
  const ctx: ConnectorContext = { config: deps.config, signal: deadline.signal, corpus: deps.corpus, resolveHost: deps.resolveHost };
  const tEvidence = Date.now();
  const claimResults = await Promise.all(extraction.claims.map((c) => checkOne(c)));
  mark("evidence", tEvidence);

  async function checkOne(c: ExtractedClaim): Promise<ClaimResult> {
    const resolved = c.class === "fact"
      ? resolveTime(c.time_text, c.time_direction, ref)
      : { time: c.time_text ?? "unknown", filledYear: false };
    const base: ClaimResult = {
      id: c.id,
      text: c.text,
      provenance: c.provenance,
      class: c.class,
      type: c.type,
      time: resolved.time,
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
    // Scope narrowed from the surrounding text: shown with the fragment it rests on (at most 2).
    for (const a of c.assumptions.slice(0, 2)) {
      const what = a.text.trim().replace(/^przyjęliśmy,?\s*że\s*/i, "").replace(/[.\s]+$/, "");
      const span = a.source_span.trim();
      const quote = span.length > 160 ? `${span.slice(0, 157).trimEnd()}…` : span;
      if (what) base.warnings.push({ type: "assumed_scope", text: `Przyjęliśmy, że ${what}, na podstawie zdania: „${quote}”.` });
    }
    const note = periodNote(resolved, ref);
    if (note) base.warnings.push({ type: "assumed_period", text: note });

    const query = {
      text: c.text,
      type: c.type,
      time: resolved.time,
      entities: c.entities,
      search_queries_pl: c.search_queries_pl.length ? c.search_queries_pl : [c.text],
      search_query_en: c.search_query_en,
      indicator: c.indicator,
      geo: c.geo,
      claimed_value: c.claimed_value,
      currency: c.currency,
    };
    // Evidence and known-incident context run side by side; context never feeds the verdict.
    const [r, known] = await Promise.all([
      retrieve(query, deps.connectors ?? CONNECTORS, ctx),
      findContextMatches(query, deps.narrativeMatchers ?? NARRATIVE_MATCHERS, { config: deps.config, signal: deadline.signal, incidents: deps.incidents }),
    ]);
    base.routes = r.routes;
    for (const route of [...r.routes, ...known.routes]) {
      if (["error", "timeout", "unavailable"].includes(route.status)) event("route_error", { claim: c.id, ...route });
    }
    if (known.matches.length) {
      event("context_match", { claim: c.id, matches: known.matches.map((m) => ({ route: m.route, url: m.url, score: m.score })) });
    }
    const withContext = (x: ClaimResult) => addContext(x, known);
    if (r.requiredFailure) {
      const state = r.requiredFailure.status === "unavailable" ? "source_unavailable" : "technical_error";
      return withContext({ ...base, system_state: state, system_message: claimStateMessage(state, `${r.requiredFailure.label}: ${r.requiredFailure.detail ?? r.requiredFailure.status}`) });
    }
    // A route an operator switched off is the deployment's choice, not a missing database.
    const optionalRouteMissing = r.routes.some((x) =>
      !x.required && x.status !== "hits" && x.status !== "no_hits" && x.detail !== SOURCE_DISABLED_DETAIL
    );

    if (r.records.length === 0) {
      return withContext({
        ...base,
        verdict: "insufficient_evidence",
        verdict_label: VERDICT_LABEL_PL.insufficient_evidence,
        strength: { level: "low", reasons: ["brak pasujących źródeł"] },
        explanation: c.asked_checker
          ? `${askedCheckerAnswer(c.asked_checker, []).lead} ${templateExplanation("insufficient_evidence", [])}`
          : templateExplanation("insufficient_evidence", []),
        missing: "W przeszukanych źródłach nie ma informacji o tym twierdzeniu. Brak wyniku nie oznacza, że to nieprawda.",
      });
    }
    if (deadline.signal.aborted) {
      return withContext({ ...base, system_state: "not_processed", system_message: claimStateMessage("not_processed") });
    }

    let assessed;
    try {
      assessed = await assessClaim({
        claim: { text: c.text, time: resolved.time, place: c.place, entities: c.entities },
        records: r.records,
        referenceDate: ref.date,
        apiKey: deps.config.secrets.openrouterApiKey,
        model: deps.config.models.evidence_assessment,
        fallbackModel: deps.config.models.claim_extraction,
        signal: deadline.signal,
      });
      usages.push(assessed.usage);
      prompts.add(EVIDENCE_ASSESSMENT_ID);
    } catch (err) {
      event("llm_error", { stage: "assess", claim: c.id, message: (err as Error).message.slice(0, 300) });
      if (deadline.signal.aborted) {
        return withContext({ ...base, system_state: "not_processed", system_message: claimStateMessage("not_processed") });
      }
      return withContext({ ...base, system_state: "technical_error", system_message: claimStateMessage("technical_error", llmMessage(err)) });
    }
    for (const p of assessed.passages) {
      if (p.quoteRejected) event("quote_rejected", { claim: c.id, source_id: p.record.source_id, stance: p.modelStance, quote: p.quote.slice(0, 200) });
    }
    for (const s of assessed.assessment.injection_signals) event("injection_detected", { claim: c.id, ...s, by: "model" });

    // Official data records: code compares the claimed number with the value for the claim period.
    const guard = numericGuard(c.claimed_value, assessed.passages);
    for (const g of guard.downgrades) event("number_check", { claim: c.id, ...g });
    for (const g of guard.upgrades) event("number_check", { claim: c.id, ...g, match: "exact_record" });
    const d = decideVerdict(guard.passages, { optionalRouteMissing });
    d.warnings.push(...guard.warnings);
    // Only passages the user sees as citations count; an old irrelevant hit is not "the material".
    const archival = guard.passages
      .filter((p) => p.stance !== "irrelevant")
      .map((p) => p.record.published_at)
      .filter((date): date is string => Boolean(date))
      .filter((date) => {
        const published = Date.parse(date);
        const now = Date.parse(today);
        return Number.isFinite(published) && Number.isFinite(now) && now - published > 365 * 86_400_000;
      });
    if (archival.length) d.warnings.push({
      type: "archival_material",
      text: "Materiał pochodzi sprzed ponad roku; sprawdź, czy nadal opisuje aktualny stan.",
    });
    const proposed = assessed.assessment.proposed_verdict;
    let explanation = assessed.assessment.explanation;
    let missingOverride: string | null = null;
    // Code took a stance from a fact-checker's rating (factcheck.ts): the model's verdict, explanation
    // and plain answer were built on the checked statement, so they are stale, not inconsistent.
    // Same for a number settled by an exact official record (numeric.ts): the record decides.
    const exactSettled = guard.upgrades.length > 0 && d.decisive.some((p) => p.record.data?.exact);
    const stale = assessed.ratingOverrides > 0 || exactSettled;
    if (assessed.ratingOverrides > 0) event("rating_override", { claim: c.id, count: assessed.ratingOverrides, model: proposed });
    if (proposed !== d.verdict) {
      event("verdict_disagreement", { claim: c.id, code: d.verdict, model: proposed, rule: d.rule });
      explanation = (stale ? factcheckExplanation(d.decisive) : null) ?? templateExplanation(d.verdict, d.decisive);
      // Pipeline §4: an inconsistent assessment (passage labels point one way, the model's own
      // reading the opposite way) is not eligible for a factual verdict.
      if (!stale && opposite(d.verdict, proposed)) {
        d.verdict = "insufficient_evidence";
        d.strength = { level: "low", reasons: ["ocena źródeł była niespójna"] };
        explanation = templateExplanation("insufficient_evidence", []);
        missingOverride = "Ocena źródeł była niejednoznaczna. Sprawdź cytowane źródła samodzielnie.";
      } else if (d.verdict === "insufficient_evidence") {
        // The model read an announcement as proof and code made it context: keep the fact we have
        // (announced, by whom, when) instead of the generic "nothing found" template.
        const announced = announcementExplanation(guard.passages);
        if (announced) {
          explanation = announced.explanation;
          missingOverride = announced.missing;
        }
      }
    }
    // Decision 016: confirmed only by official announcements whose day has passed. Code owns this
    // verdict (the prompt still labels announcements "context"), so it owns the wording and the lead
    // word too, and the strength is low: nobody reported how the event went.
    const byAnnouncement = d.verdict === "confirmed" && d.decisive.length > 0 && d.decisive.every((p) => p.announcedPassed);
    if (byAnnouncement) {
      event("announced_passed", { claim: c.id, model: proposed, days: [...new Set(d.decisive.map((p) => p.announcedPassed))] });
      explanation = announcedPassedExplanation(d.decisive);
      d.strength = { level: "low", reasons: ["tylko oficjalna zapowiedź, termin już minął", "brak relacji z przebiegu"] };
    }
    // The leading word only when code and model agree on the verdict (or the verdict came from a rating).
    const plain = byAnnouncement ? "yes" : stale && proposed !== d.verdict ? plainFromVerdict(d.verdict) : assessed.assessment.plain_answer;
    const partly = d.verdict === "misleading" && ratedPartlyTrue(d.decisive);
    const lead = (proposed === d.verdict || stale || byAnnouncement) && !partly ? leadWord(d.verdict, plain, asksQuestion) : null;
    explanation = c.asked_checker
      // "Did <checker> check X?": answer that question first; the verdict on X follows.
      ? `${askedCheckerAnswer(c.asked_checker, guard.passages).lead} ${withLead(explanation, null)}`
      : withLead(explanation, lead);
    const order = new Map(d.decisive.map((p, i) => [p.record.source_id, i]));
    const citations: Citation[] = guard.passages
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
    return withContext({
      ...base,
      verdict: d.verdict,
      verdict_label: VERDICT_LABEL_PL[d.verdict],
      strength: d.strength,
      explanation,
      missing: d.verdict === "insufficient_evidence"
        ? withAbsenceNote(missingOverride ?? assessed.assessment.missing ?? "Nie znaleźliśmy źródła, które jednoznacznie to rozstrzyga.")
        : null,
      citations,
      warnings: [...base.warnings, ...d.warnings],
    });
  }

  // ── 8. Assemble ────────────────────────────────────────────────────────────
  // Facts first, opinions and predictions after them as one-liners (hard constraint 21).
  const facts = claimResults.filter((c) => c.class === "fact");
  response.claims = [...facts, ...claimResults.filter((c) => c.class !== "fact")];
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
  // Only complete answers are cached: a partial one (a source failed) must be retried, not replayed.
  if (status === "ok") await deps.store.setCached(cacheKey, structuredClone(result), sessionHash);
  return result;
}
