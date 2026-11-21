# Codebase: what is built and how it runs
The code layout, what each part does today, what was measured, and what is still missing. Decided in [decisions/004](../decisions/004-first-build-stack.md) and [decisions/005](../decisions/005-supabase-schema-workflow.md). How to run it: the repo [README](../../../README.md).

## Layout
| Path | Role |
|---|---|
| `packages/core/src/pipeline/check.ts` | `runCheck`: validate → intake → PII mask + injection scan → 5-min cache → reference date → extract (LLM #1) → per claim in parallel: retrieve → assess (LLM #2) → code verdict → log |
| `packages/core/src/intake/` | `url.ts` (SSRF guards, DNS check via host hook, ≤3 revalidated redirects, robots.txt, tracking params stripped, Readability), `image.ts` (EXIF/XMP/IPTC and PNG text chunks stripped, vision call) |
| `packages/core/src/guard/` | PII rules (e-mail, phone, PESEL with checksum, IBAN, cards with Luhn, ID card, street address, IP), injection patterns (pl/en), quote normalization |
| `packages/core/src/connectors/` | `google-factcheck.ts`, `sejm-eli.ts`, `eurostat.ts`, `nbp.ts`, `gus.ts`, `corpus.ts` (mock, empty); `stats-catalog.ts` (16 indicators); `mod.ts` = the deployment profile |
| `packages/core/src/sources/catalog.ts` | trusted-source allowlist with tiers ([decision 008](../decisions/008-trusted-source-allowlist.md)), served at `GET /api/v1/sources` |
| `packages/core/src/pipeline/numeric.ts` | code-side number check for official data records |
| `packages/core/src/pipeline/verdict.ts` | code-owned verdict rules ([pipeline §5](verification-pipeline.md#5-apply-verdict-rules)) |
| `packages/core/src/pipeline/dates.ts` | reference date (publication → original in the corpus → submission), the year for dates written without one, dates with a year and relative words normalized to the ISO-like form parsePeriod reads ([pipeline §2](verification-pipeline.md#2-extract-and-classify-claims)) |
| `packages/core/src/prompts/*.ts` | prompts as code, versioned (`claim-extraction@3`, `evidence-assessment@2`, media `@1`; claim-extraction v2 kept for log replay); wording mirrors [prompts/](../prompts/README.md) |
| `packages/core/src/store/` | `CheckStore` / `CorpusStore` interfaces + in-memory mock |
| `packages/core/src/config.ts` | models, routing, limits ([decision 003](../decisions/003-config-in-code.md)) |
| `apps/api/main.ts` | Hono routes under `/api/v1` ([api-reference](api-reference.md)), mock mode, CORS (`WEB_ORIGINS`), 8 MB body limit, 12 req/min per IP or per end user for keyed clients, DNS resolver for URL intake |
| `packages/core/src/contract.ts`, `mock/fixtures.ts` | contract v1 as zod/JSON Schema; 18 synthetic mock scenarios ([decision 006](../decisions/006-api-contract-v1-and-mock.md)) |
| `apps/bot/` | messaging bot on the Vercel Chat SDK (Discord slash commands, WhatsApp, Messenger) plus a console channel, over the HTTP API; status in [messaging-bot](messaging-bot.md#implementation-status-2026-11-21) |
| `apps/web/` | Astro page: Tekst / Link / Obraz tabs, paste an image from the clipboard, renders verdicts vs system states differently, DOM `textContent` only (no `innerHTML`) |
| `supabase/` | schemas → generated migrations workflow, baseline privileges migration, guards |

## Evidence routes today
| Route | Applies to | Required | Notes |
|---|---|---|---|
| Google Fact Check | all fact claims | yes | 2 Polish queries (`languageCode=pl`) + 1 English query; the passage is assembled only from API fields (claim, claimant, rating, title); **only allowlisted publishers are kept**, tier from the catalog |
| Sejm ELI | `legal` | yes | title search with up to 3 queries; amending acts are labelled as such in the record |
| Eurostat | claims with a catalog `indicator` that has a Eurostat series | yes | series for the claim's country (claim year − 4 → latest), plus one call for all countries in that year: EU-27 value, lowest/highest member, the country's rank. Status flags shown in Polish |
| NBP | `exchange_rate`, `gold_price`, `nbp_reference_rate` | yes | rate in force on a date (7-day window, last quote ≤ date), month/year summaries (mean, min, max, first, last); reference-rate history from the archive XML |
| GUS BDL | `population` (verified variable only), Poland | no | optional: was unreachable on 2026-11-21, so an outage only adds the "not all sources" caveat |
| Corpus | all | no | empty mock, reported as `skipped` |

A required route that is unavailable (e.g. no Google key, Eurostat down for a statistics claim) gives the claim a system state, never a verdict. Not covered yet, and listed in `limitations`: Sejm votings, institutions' press releases, regional statistics, MSZ Odyseusz, EUvsDisinfo.

A text message that contains a link: the first link is also fetched through the URL intake (same SSRF/robots guards) and read as `article` material; a failure only adds a warning (organizer samples E/I, [organizer-sample-answers](../hackathon/organizer-sample-answers.md)).

## Official statistics and the number check
- Extraction (prompt v2) classifies an indicator claim: `indicator` (a key from `stats-catalog.ts`; the list in the prompt is generated from it), `geo`, `claimed_value`, `currency`, and `time` as `YYYY`/`YYYY-MM`/`YYYY-MM-DD`. The model never looks up or writes official numbers: code fetches them and writes every line of the record ("2024: 2,9%").
- The record carries machine-readable `data` (points + the periods the claim refers to). After the assessment, `numericGuard` compares `claimed_value` with the official value. Tolerance = max(half a unit of the claim's stated precision, 2% relative, 0.05 pp for rates); deficits compare absolute values.
- It **only downgrades** a stance the numbers contradict to `context` (a "supports" for a wrong number, a "refutes" for a matching number), and warns when the number matches another period. It never upgrades: a claim about registered unemployment must not become `false` against Eurostat's survey rate. Every downgrade is logged as a `number_check` event.
- Definitions differ between sources (Eurostat population 1 January vs GUS 31 December; HICP vs CPI; survey vs registered unemployment). Each record states its definition, and the assessment prompt labels a definition mismatch as context.

## Implemented interim choices (Idea, revisit with the eval)
- **Only allowlisted publishers are evidence; one publisher = one origin; tier by credentials** ([decision 008](../decisions/008-trusted-source-allowlist.md)).
- **A fact-check counts as sufficient alone**, like an official source (as the prompt says). The pipeline draft wants its demonstrated evidence: still an open question.
- **Support vs "misleading", both above the threshold, is a conflict** → `brak wystarczających dowodów` + `sources_conflict`.
- **Inconsistent assessment guard** (pipeline §4): when the passage labels lead code to `confirmed` but the model's own proposed verdict is `false`/`misleading` (or the reverse), the claim abstains.
- **A lone "misleading" reading does not override a refutation backed by more independent origins** (found by the benchmark: one misleading passage beat three fact-check refutations).
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
2. A route for MSZ's Odyseusz travel advisories (expected by the organizer samples) and the corpus (gov.pl, CERT, RCB communiqués).
3. Ask the Sprawdzam To editors for consent to ingest; re-verify the IFCN status of OKO.press and Konkret24.
4. Supabase: `private.check_logs` / `check_events` tables, then the corpus with hybrid search.
5. Messaging bot: M1 code in `apps/bot`; next is deploying it on Vercel with a Discord app, then M1b (Redis, deep health, consistency script). See [messaging-bot](messaging-bot.md#implementation-status-2026-11-21).
