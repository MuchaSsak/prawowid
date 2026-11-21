# Codebase: what is built and how it runs
The code layout, what each part does today, what was measured, and what is still missing. Decided in [decisions/004](../decisions/004-first-build-stack.md) and [decisions/005](../decisions/005-supabase-schema-workflow.md). How to run it: the repo [README](../../../README.md).

## Layout
| Path | Role |
|---|---|
| `packages/core/src/pipeline/check.ts` | `runCheck`: validate → intake → PII mask + injection scan → 5-min cache → extract (LLM #1) → per claim in parallel: retrieve → assess (LLM #2) → code verdict → log |
| `packages/core/src/intake/` | `url.ts` (SSRF guards, DNS check via host hook, ≤3 revalidated redirects, robots.txt, tracking params stripped, Readability), `image.ts` (EXIF/XMP/IPTC and PNG text chunks stripped, vision call) |
| `packages/core/src/guard/` | PII rules (e-mail, phone, PESEL with checksum, IBAN, cards with Luhn, ID card, street address, IP), injection patterns (pl/en), quote normalization |
| `packages/core/src/connectors/` | `google-factcheck.ts`, `sejm-eli.ts`, `corpus.ts` (mock, empty); `mod.ts` = the deployment profile |
| `packages/core/src/pipeline/verdict.ts` | code-owned verdict rules ([pipeline §5](verification-pipeline.md#5-apply-verdict-rules)) |
| `packages/core/src/prompts/*.v1.ts` | prompts as code, versioned; wording mirrors [prompts/](../prompts/README.md) |
| `packages/core/src/store/` | `CheckStore` / `CorpusStore` interfaces + in-memory mock |
| `packages/core/src/config.ts` | models, routing, limits ([decision 003](../decisions/003-config-in-code.md)) |
| `apps/api/main.ts` | Hono routes under `/api/v1` ([api-reference](api-reference.md)), mock mode, CORS (`WEB_ORIGINS`), 8 MB body limit, 12 req/min per IP or per end user for keyed clients, DNS resolver for URL intake |
| `packages/core/src/contract.ts`, `mock/fixtures.ts` | contract v1 as zod/JSON Schema; 18 synthetic mock scenarios ([decision 006](../decisions/006-api-contract-v1-and-mock.md)) |
| `apps/web/` | Astro page: Tekst / Link / Obraz tabs, paste an image from the clipboard, renders verdicts vs system states differently, DOM `textContent` only (no `innerHTML`) |
| `supabase/` | schemas → generated migrations workflow, baseline privileges migration, guards |

## Evidence routes today
| Route | Applies to | Required | Notes |
|---|---|---|---|
| Google Fact Check | all fact claims | yes | 2 Polish queries (`languageCode=pl`) + 1 English query; the passage is assembled only from API fields (claim, claimant, rating, title) |
| Sejm ELI | `legal` | yes | title search with up to 3 queries; amending acts are labelled as such in the record |
| Corpus | all | no | empty mock, reported as `skipped` |

A required route that is unavailable (e.g. no Google key) gives the claim `source_unavailable`, never a verdict. Not covered yet, and listed in `limitations`: GUS BDL, NBP, Eurostat, Sejm votings, institutions' press releases, EUvsDisinfo.

## Implemented interim choices (Idea, revisit with the eval)
- **A fact-check counts as sufficient alone**, like an official source (as the prompt says). The pipeline draft wants its demonstrated evidence: still an open question.
- **Support vs "misleading", both above the threshold, is a conflict** → `brak wystarczających dowodów` + `sources_conflict`.
- **Inconsistent assessment guard** (pipeline §4): when the passage labels lead code to `confirmed` but the model's own proposed verdict is `false`/`misleading` (or the reverse), the claim abstains.
- Fact-claim cap = **8** (prompt), not 12 (pipeline).
- Answers are Polish only for now; en/uk are not wired yet.
- Private names are not masked yet (no local recognizer); disclosed in limitations.

## Measured (smoke runs, 2026-11-21, synthetic inputs)
- `only: ["mistral/eu"]` routing is accepted by OpenRouter and served by provider "Mistral".
- Text check: 5–9 s end to end (extraction ~2.5–3 s, evidence + assessment ~3–5 s), $0.0006–0.0009 per check.
- Image check: vision OCR ~1.7 s, then the normal flow.
- URL intake of a gov.pl page ~0.6 s; a homepage correctly returns `needs_clarification`.
- Assessment with mistral-small labelled an act's title line as "supports" and gave confident wrong verdicts; mistral-large did not, so it is the default (see [model-selection](model-selection.md)).

## Reliability
- Mistral Large on the EU endpoint sometimes returns 429. The client retries once after 1.5 s, then falls back to Small for that call (`fallbackModel`).

## Next steps
1. Set OPENROUTER_API_KEY and GOOGLE_FACT_CHECK_API_KEY in the Deno Deploy app (live checks fail without them); point the web app at the deployed API (`PUBLIC_API_URL`), then set `WEB_ORIGINS` on the API.
2. Numeric routes (GUS BDL, NBP, Eurostat) with code-side typed comparison (no LLM).
3. Our own eval set (≥30 cases) and a metrics script, before tuning prompts further.
4. Supabase: `private.check_logs` / `check_events` tables, then the corpus with hybrid search.
5. The messaging-bot adapter over the same `runCheck`.
