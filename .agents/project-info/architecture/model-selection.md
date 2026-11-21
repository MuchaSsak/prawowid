# Model selection (OpenRouter) with GDPR in mind
Which models to use per pipeline step: quality, reliability, cost and GDPR compliance. **Idea**: a recommendation, not decided. Verified on 2026-11-21 from the live OpenRouter API (`/api/v1/models`, `/api/v1/models/{id}/endpoints`, `/api/v1/embeddings/models`) and the provider-routing docs.

## Verified facts
- **Only Mistral offers EU-tagged endpoints:** `mistral/eu` and `mistral/zdr` for mistral-small-2603, mistral-large-2512 and voxtral-small. `mistral-embed-2312` has only `mistral/zdr`.
- **Claude Haiku 5.5** runs on Google Vertex (global), Claude on AWS, Azure (global), Anthropic and Bedrock. **Gemini** runs on Google AI Studio and Vertex (global). **GPT-5-mini** runs on OpenAI and Azure. **bge-m3** is hosted by Parasail and DeepInfra. None of these has an EU tag, so treat them as **non-EEA processing**.
- **Provider routing options:** `provider: { data_collection: "deny", zdr: true, only: [...], require_parameters: true }`. **Full EU in-region routing (`eu.openrouter.ai`) is Business/Enterprise only.**
- OpenRouter itself is a US intermediary, so it is a data processor in the chain. Pinning by endpoint tag works: `only: ["mistral/eu"]` with `allow_fallbacks: false` was accepted and served by provider "Mistral" (tested with our key, 2026-11-21, [codebase](codebase.md)).
- **Google Safety Retention (from 2026-10-18):** OpenRouter shows that Google models now require Safety Retention unless you opt out in the account privacy settings and workspace guardrails. This affects the Gemini video path. Opt out before using it. (user screenshot of the OpenRouter dashboard, 2026-11-21)
- **Routing is set per step in code**, not account-wide: an account-wide Mistral-only or ZDR-only restriction would block Gemini video, bge-m3 embeddings and the fallback model. See [decision 003](../decisions/003-config-in-code.md).
- All candidates below support `structured_outputs` (JSON schema). We validate it in code anyway.

## Prices (per 1M tokens, input/output, live 2026-11-21)
| Model | Price | Where data goes | Notes |
|---|---|---|---|
| `mistralai/mistral-small-2603` | $0.15 / $0.60 | **EU (`mistral/eu`) or ZDR** | fast, good Polish, cheap |
| `mistralai/mistral-large-2512` | $0.50 / $1.50 | **EU or ZDR** | strong reasoning, still cheap |
| `mistralai/mistral-large-4-0` | $0.70 / $2.10 | Mistral | 1M ctx, top Mistral |
| `mistralai/mistral-embed-2312` | $0.10 / - | ZDR | EU-vendor embeddings |
| `mistralai/voxtral-small-24b-2507` | $0.10 / $0.30 | **EU or ZDR** | audio transcription; decodes mp3, wav, ogg only (probed 2026-11-21) |
| `anthropic/claude-haiku-5.5` | $0.10 / $0.50 | global (non-EEA) | strong and cheap; comparison or fallback |
| `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | global (non-EEA) | the only cheap option for **video** + YouTube |
| `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | global (non-EEA) | cheaper omni fallback |
| `baai/bge-m3` | $0.01 / - | US hosts | best multilingual retrieval; **open weights**, so it can be self-hosted in the EU later |
| DeepSeek, Qwen | very cheap | China-linked providers | **avoid**: GDPR, transfer risk and a bad look for MSZ |

## Recommendation (Idea)
| Step | Model | Why |
|---|---|---|
| 1. Claims + types + queries | **mistral-small-2603** via `mistral/eu` | EU, cheap, a structured task |
| 2. Stance + exact quotes (the critical step) | **mistral-large-2512** (code default since 2026-11-21) | EU. In smoke runs Small labelled a bare act title as "supports" and produced confident wrong verdicts; Large did not. Revisit with the eval; Small stays available via `MODEL_EVIDENCE_ASSESSMENT` |
| Embeddings | **bge-m3** (quality, cross-lingual PL↔EN/RU) on **masked, public** text only, or `mistral-embed` for a strictly EU-vendor path | the corpus is public data; user queries are PII-masked first |
| Images (OCR) | **mistral-small-2603** (vision, EU) | keeps the image path in the EU; the OCR text is redacted before the next step |
| Video / YouTube | **gemini-3.1-flash-lite** (code default for uploads, `MODEL_VIDEO_TRANSCRIPTION`) | the only practical video model; **disclose non-EEA processing**, and use it only for public videos |
| Audio (uploaded) | **voxtral-small** via `mistral/eu` (code default, `MODEL_AUDIO_TRANSCRIPTION`) | EU transcription; webm/m4a/aac audio falls back to the video model |
| Benchmark / fallback | claude-haiku-5.5 | evaluate on approved fixtures. Enable live fallback only if it meets the [verification workflow](verification-pipeline.md) deployment policy |

**Cost model.** Count extraction on each uncached check, stance assessment on claims requiring prose, and vision transcription on images. Measure actual billed usage per stage and report cost per 100 checks with the input mix and call counts. Structured evidence can skip the evidence-model call. Earlier estimate for text only (all Small, 2k/0.4k + 5k/0.5k tokens): about $1.4 per 1,000 checks, about $4 with Large on the assessment step; images and video are extra.

## GDPR / compliance checklist
- **Mask private data before outbound search, model calls and logging** according to the [workflow intake rules](verification-pipeline.md#1-validate-and-prepare-input).
- **Use `data_collection: "deny"` + `zdr: true` on every request.** Pin Mistral EU for text.
- **Data minimization:** send only claim text + passages, never user metadata. Discord user IDs are hashed.
- **Retention:** follow the proposed [workflow retention and session deletion rules](verification-pipeline.md#7-record-outcome-and-evaluate-review-eligibility).
- **Transparency page:** list every processor (OpenRouter (US), Mistral (EU), Google (US, video only), Supabase (EU Frankfurt), Deno Deploy), what each one receives, and the retention. Disclose non-EEA transfers.
- **The pilot path:** swap OpenRouter for Mistral's API directly, or self-hosted models (bge-m3, Bielik or Gemma), with one config change. This addresses the "reduce non-EEA dependence" bonus.
