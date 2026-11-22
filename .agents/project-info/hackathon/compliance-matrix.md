# Compliance matrix: the task's requirements vs our design
Every requirement from the task PDF checked against our current design (2026-11-21, re-read from sources/2026-11-21-msz-pelna-tresc-zadania.pdf and sources/2026-11-21-msz-regulamin-zadania.pdf). **The MVP section was re-checked against the code on 2026-11-21 18:45, updated at 19:45 after two pulls, and re-checked against the PDF and the deployed services on 2026-11-22** (user request; one live check on the deployed API, health of API and bot); the other sections still describe the design and need the same pass. Every row still has to be shown working in the demo and the eval. Pages: [task-brief.md](task-brief.md), [judging-and-metrics.md](judging-and-metrics.md), [rules/hard-constraints.md](../rules/hard-constraints.md).

Legend: ✅ covered by design · ⚠️ risk or partly covered · ❌ gap, work needed

## MVP (sec. 3), the gate
Legend here: ✅ built and tested · ⚠️ built, not yet ready for the jury · ❌ missing.

| Requirement | State in the code (2026-11-21) | Status |
|---|---|---|
| Text or URL input via a responsive web UI | `apps/web` (Astro chat flow, layouts for ≤720 px and ≥1024 px) → `POST /api/v1/check`; always live since 2026-11-21 (the demo/live switch was removed; sample data only with `?test=true`, [decision 009](../decisions/009-video-audio-input-and-web-composer.md)) | ✅ 2026-11-22: https://prawdomat.vercel.app answers 200; the deployed API (https://prawowid.mateusz.deno.net) is `mode: live` with both keys set (`/api/v1/health`) |
| A second channel or demo adapter (not Telegram or WeChat) | `apps/bot`: Discord `/sprawdz`, WhatsApp, Messenger and a console channel over the same API; tested with a real Discord app locally ([messaging-bot](../architecture/messaging-bot.md)) | ⚠️ **deployed** (https://prawdomat-bot.vercel.app); 2026-11-22 `/health` lists `platforms: ["discord", "messenger"]`, state in memory. Not yet confirmed: a real Discord/Messenger reply in production, and a way for the jury to reach it (public Discord invite or Messenger page, plus instructions in the README). WhatsApp not enabled. The console channel counts as a demo adapter |
| Detect one or more claims | `claim-extraction@3`, tests in `pipeline_test.ts` | ✅ |
| A described set with ≥2 source types; show the materials used | fact-checks (Google Fact Check), legal acts (Sejm ELI), official statistics (Eurostat, NBP, GUS), EUvsDisinfo as context; the list at `GET /api/v1/sources`; verified quotes and links in every answer | ✅ |
| Result + justification + strength + limitations | contract v1 ([response-contract](../product/response-contract.md)) | ✅ |
| Answer in Polish, plain language | always Polish, whatever the input or source language (decided 2026-11-22, [language policy](../product/response-contract.md#language-policy)) | ✅ |
| Log: question, time, sources, verdict | every check is saved (masked question, time, channel, verdicts, source ids) in the in-memory store, readable at `GET /api/v1/admin/checks` (needs `ADMIN_TOKEN`), and written as a JSON audit line to the host log (no question text, so sessions stay deletable) ([api-reference](../architecture/api-reference.md)) | ⚠️ the full rows live in memory per instance until Supabase (`private.check_logs`, [decisions/001](../decisions/001-private-logs-schema.md)); the audit lines survive. Set `ADMIN_TOKEN` on Deno Deploy |
| Abstain without a fake answer | verdict rules in code; outages and missing keys → system states; tests | ✅ |
| End-to-end with no manual intervention | one pipeline; local live eval 98% end-to-end (run 3, [benchmark](../evaluation/benchmark.md)) | ✅ 2026-11-22: a live text check on the deployed API returned `status: ok`, verdict `fałszywe` with an NBP citation, 7.3 s, $0.0004. Still prove it in the demo video, and for the bot channel too |

## Behaviour (sec. 2) and technical requirements (sec. 5)
| Requirement | Our design | Status |
|---|---|---|
| Exactly 5 verdicts; failure, inability and clarification communicated separately | response contract A vs B | ✅ |
| Separate source material from the model's interpretation; title, publisher, date, link, excerpt | "Co mówią źródła" vs "Nasza ocena"; citations from the DB, quotes verified verbatim | ✅ |
| Strength from explicit factors | code: tier, recency, match, independence | ✅ |
| Notify a designated user on high-risk or repeated unanswered questions | `risk` field + similarity dedupe → `private.moderator_cases` + webhook to the moderator the admin sets | ⚠️ the admin setting (who the moderator is) still needs designing |
| Prompt injection resistance | data boundary in every prompt, JSON-only models with no tools, `injection_signals` + regex scan, logged events | ✅ (needs ≥90% on our attack set) |
| Channel handling separate from verification; model swappable without a rebuild | `packages/core` + adapters (web, bot, eval); `MODEL_<STEP>` env; evidence routes and known-incident matchers injectable through `deps` and listed at `GET /api/v1/sources`; recipes and proving tests in [extensibility](../architecture/extensibility.md) (also the bonus item "architektura umożliwiająca podłączanie…") | ✅ tested (`pipeline_test.ts`, `core_test.ts`, `main_test.ts`) |
| Corpus ≥100 docs, ≥10 domains, ≥2 types, auditable source list | trusted-source catalog public at `GET /api/v1/sources` ([decision 008](../decisions/008-trusted-source-allowlist.md)); `alert-corpus.jsonl` is converted from the local source snapshot and built into `alert-corpus-index.json`; the API loads an in-memory BM25 index through `IndexedCorpusStore`; EUvsDisinfo stays outside the corpus | ⚠️ final source/licence coverage and the 10-domain threshold require a build-time audit |
| Publication and retrieval timestamps; warn about archival material | `published_at`, `retrieved_at`; `archival_material` warning | ✅ |
| Security: input validation, separated instructions, tool limits, secrets, rate limiting, event logging | all in the flow; `.env` + `.gitignore` | ✅ |
| Privacy: minimisation, PII masking, retention, deletable session | masking before any LLM call or log (local rules; private names are not masked yet), 30-day `pg_cron`, `DELETE /api/v1/session/{id}`, called by the "Usuń dane sesji" button in the landing footer (toast on success, then a fresh session id) | ⚠️ deletion reaches only the in-memory store of the instance that answers (until Supabase). Not counted as a gap: `/prywatnosc` is deliberately not a real policy for the hackathon (user, 2026-11-21); it lists what one would have to cover |
| Observability: latency, model use, retrieval errors, abstentions, cost per answer | `meta` + `check_events`, OpenRouter `usage.cost` | ✅ |
| Accessibility: responsive, contrast, plain language | tone rules in the contract | ⚠️ UI and contrast still to be done and checked (WCAG AA) |
| Same result across channels | same core, `temperature 0`, cache by normalised input, canonical Polish verdict label | ✅ |
| "Recommended" ≠ "escalated" | `escalation: none / recommended / queued` | ✅ |
| External deps: keys, limits, costs, data location, failure behaviour | [model-selection.md](../architecture/model-selection.md) + a processors page | ⚠️ the README section still needs writing |
| Multimodal: disclose cost, scope, retention, limits | [multimodal-media.md](../architecture/multimodal-media.md) | ⚠️ text exists, needs to go into the README |

## Prohibitions (sec. 5)
| Rule | Our design | Status |
|---|---|---|
| No LLM output as fact without a source | verdicts need verified quotes from stored sources | ✅ |
| No bypassing protections or paid databases | robots.txt respected; EUR-Lex HTML and Demagog skipped; no YouTube download | ✅ |
| Truth never decided from domain, author, channel, popularity, or **a label generated by the same model** | domain/catalog matches are warnings only. The stance is a model label, but it must carry a verbatim quote that is shown to the user, and the rules need source tiers or independent confirmations | ⚠️ defensible, but name it in the risks; optional second-model cross-check for high-risk claims |
| Source status (EU sanctions) never decides truth on its own | `source_status` warning only | ✅ |
| No claim of full reverse image search without a working API | not planned, and the UI says so | ✅ (keep it that way) |
| **No archiving of full content or images without a legal basis, license, retention, access control and deletion procedure** | the corpus uses a one-time snapshot and stores short indexed fragments, not a copy of uploaded images or private text; official/legal records use public-sector reuse; Demagog records keep only title, rating and short claim/excerpt; source list, URL, publication date and retrieval date remain auditable; server-only access follows [decision 001](../decisions/001-private-logs-schema.md) | ⚠️ policy: keep the snapshot for the hackathon/replay period, delete stale raw JSON and rebuilds on request, rebuild rather than retain derivative history, per-source licence review remains required; EUvsDisinfo is never archived in this corpus |

## Evaluation integrity (sec. 6)
| Requirement | Our design | Status |
|---|---|---|
| No test answers in prompts, no hardcoded examples | prompts use rules, and few-shot examples (if any) are synthetic | ✅ (rule 16) |
| Metrics: macro-F1 ≥0.75, citation coverage ≥95%, correctness ≥85%, abstention ≥80%, injection ≥90%, latency ≤30 s, cost per 100 | | ⚠️ built: 50-case set + `eval/run.ts` computes them ([evaluation/benchmark.md](../evaluation/benchmark.md)); macro-F1 0.71 (run 3) is below 0.75 and citation correctness needs human labels |
| Disclose unsupported cases | a "Czego nie obsługujemy" section | ❌ to write |

## Source coverage gaps (affect accuracy, not the gate)
- **Institutional statements** (nbp.pl, trybunal.gov.pl, ministries outside gov.pl): not ingested. Claims of the type "institution X announced…" will often end as `brak wystarczających dowodów`.
- **International politics** (e.g. US statements): our sources are mostly Polish and official. ClaimReview helps; consider whitehouse.gov or MSZ statements.
- Latency ≤30 s with 2 LLM calls + live APIs: plausible but **unmeasured**, and the Deno Deploy request limits are untested.

## Deliverables (sec. 4) and the regulamin
Not started: the 4,000-character description, the ≤12-slide PDF, the ≤3-minute video, the README run instructions, the architecture and source/license descriptions, the test results with data, the risk list (hallucinations, source bias, privacy, injection, availability, abuse), the cost estimates (drafted as a sheet, see [deliverables.md](deliverables.md); README summary still missing) and the list of unsupported cases. See [deliverables.md](deliverables.md). Regulamin: we transfer the copyright to MSZ if we win, so **record every dependency's license** and use only permissive ones.
