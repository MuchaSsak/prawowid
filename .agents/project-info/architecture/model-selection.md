# Model selection (OpenRouter) with GDPR in mind
Which models to use per pipeline step: quality, reliability, cost and GDPR compliance. **Idea**: a recommendation, not decided. Verified on 2026-11-21 from the live OpenRouter API (`/api/v1/models`, `/api/v1/models/{id}/endpoints`, `/api/v1/embeddings/models`) and the provider-routing docs.

## Verified facts
- **Only Mistral offers EU-tagged endpoints:** `mistral/eu` and `mistral/zdr` for mistral-small-2603, mistral-large-2512 and voxtral-small. `mistral-embed-2312` has only `mistral/zdr`.
- **Claude Haiku 5.5** runs on Google Vertex (global), Claude on AWS, Azure (global), Anthropic and Bedrock. **Gemini** runs on Google AI Studio and Vertex (global). **GPT-5-mini** runs on OpenAI and Azure. **bge-m3** is hosted by Parasail and DeepInfra. None of these has an EU tag, so treat them as **non-EEA processing**.
- **Provider routing options:** `provider: { data_collection: "deny", zdr: true, only: [...], require_parameters: true }`. **Full EU in-region routing (`eu.openrouter.ai`) is Business/Enterprise only.**
- OpenRouter itself is a US intermediary, so it is a data processor in the chain. Whether pinning by endpoint tag works (`only: ["mistral/eu"]`) is an **Assumption**: test it with our key and check the `provider` field in the response.
- All candidates below support `structured_outputs` (JSON schema). We validate it in code anyway.

## Prices (per 1M tokens, input/output, live 2026-11-21)
| Model | Price | Where data goes | Notes |
|---|---|---|---|
| `mistralai/mistral-small-2603` | $0.15 / $0.60 | **EU (`mistral/eu`) or ZDR** | fast, good Polish, cheap |
| `mistralai/mistral-large-2512` | $0.50 / $1.50 | **EU or ZDR** | strong reasoning, still cheap |
| `mistralai/mistral-large-4-0` | $0.70 / $2.10 | Mistral | 1M ctx, top Mistral |
| `mistralai/mistral-embed-2312` | $0.10 / - | ZDR | EU-vendor embeddings |
| `mistralai/voxtral-small-24b-2507` | $0.10 / $0.30 | **EU or ZDR** | audio transcription |
| `anthropic/claude-haiku-5.5` | $0.10 / $0.50 | global (non-EEA) | strong and cheap; comparison or fallback |
| `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | global (non-EEA) | the only cheap option for **video** + YouTube |
| `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | global (non-EEA) | cheaper omni fallback |
| `baai/bge-m3` | $0.01 / - | US hosts | best multilingual retrieval; **open weights**, so it can be self-hosted in the EU later |
| DeepSeek, Qwen | very cheap | China-linked providers | **avoid**: GDPR, transfer risk and a bad look for MSZ |

## Recommendation (Idea)
| Step | Model | Why |
|---|---|---|
| 1. Claims + types + queries | **mistral-small-2603** via `mistral/eu` | EU, cheap, a structured task |
| 2. Stance + exact quotes (the critical step) | **mistral-small-2603** first; switch to **mistral-large-2512** if the eval F1 < 0.75 | EU; Large costs only about 3× Small |
| Embeddings | **bge-m3** (quality, cross-lingual PL↔EN/RU) on **masked, public** text only, or `mistral-embed` for a strictly EU-vendor path | the corpus is public data; user queries are PII-masked first |
| Images (OCR) | **mistral-small-2603** (vision, EU) | keeps the image path in the EU |
| Video / YouTube | **gemini-3.1-flash-lite** (optional bonus path) | the only practical video model; **disclose non-EEA processing**, and use it only for public videos |
| Audio (uploaded) | **voxtral-small** via `mistral/eu` | EU transcription |
| Benchmark / fallback | claude-haiku-5.5 | run once in the eval for comparison and as an outage fallback |

**Cost per check** (≈ 2k in / 0.4k out for step 1 + 5k in / 0.5k out for step 2): all Small ≈ **$0.0014 → about $1.4 per 1,000 checks**. With Large on step 2 ≈ **$4 per 1,000**. Video adds about $0.01-0.02 per 5-minute video. These estimates are to be replaced by the measured `usage.cost`.

## GDPR / compliance checklist
- **Mask PII before any LLM or embedding call** (PESEL, phone, email, IBAN, names where detectable). Log only the masked question.
- **Use `data_collection: "deny"` + `zdr: true` on every request.** Pin Mistral EU for text.
- **Data minimization:** send only claim text + passages, never user metadata. Discord user IDs are hashed.
- **Retention:** logs kept N days (e.g. 30), plus a "delete my session" endpoint (required by the brief).
- **Transparency page:** list every processor (OpenRouter (US), Mistral (EU), Google (US, video only), Supabase (EU Frankfurt), Deno Deploy), what each one receives, and the retention. Disclose non-EEA transfers.
- **The pilot path:** swap OpenRouter for Mistral's API directly, or self-hosted models (bge-m3, Bielik or Gemma), with one config change. This addresses the "reduce non-EEA dependence" bonus.
