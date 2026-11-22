# Compliance matrix: the task's requirements vs our design
Audit of the MSZ task brief against checkout `319d416` and public endpoints on 2026-11-22. See [task brief](task-brief.md), [metrics](judging-and-metrics.md) and [deliverables](deliverables.md).

## Base readiness on 2026-11-22

The functional path is built. Jury readiness remains open.

- The production homepage served the configured API URL. The API accepted a preflight and answered a live Polish text check from the web origin. A gov.pl URL check also completed. A synthetic no-evidence question returned `insufficient_evidence`. The core and API test runs passed 288 tests including the separate KV test.
- The console adapter answered the same live question about the euro in Poland. Both paths returned `false`, with two evidence links from the web API and three from the console. The console renderer also omits source titles. The bot deployment's documented `/health` returned HTTP 404. Use the working console adapter for jury rehearsal and document its launch command.
- The checked-in corpus has 9,792 records across 14 hostnames, with official sources and fact-checks. Confirm the organizer's interpretation of the 10-domain minimum if subdomains count as one domain. All records have a retrieval timestamp and 688 lack publication timestamps. The live index reports 31,980 passages/records through its health endpoint.
- The checked-in JSONL contains full bodies, including Demagog, as documented in [decision 012](../decisions/012-source-ingestion.md). Verify licensing, legal basis, retention, access and deletion for the distributed snapshot. The checked-in full bodies contradict the earlier excerpt-only description.
- The stored report measured 86% citation coverage across factual claims against the brief's 95% target. Its 100% figure covers decisive verdicts only. Human citation correctness is unmeasured. The latest branch evaluation in the wiki reached macro-F1 0.75 on its final reported build. See [benchmark](../evaluation/benchmark.md).
- The official-announcement rule in [decision 016](../decisions/016-official-announcement-past-day.md) can confirm an event based on the advance notice after the scheduled day. That leaves a risk under the base abstention gate when no source verifies that the event took place.
- Section 2 calls for notifying an admin-designated person about high-risk or repeated unresolved reports. Section 3 leaves analytics and the full moderator case workflow optional. The response contract still recommends escalation. An optional Discord notification is implemented locally and awaits live configuration. See [moderator DMs](../architecture/api-reference.md#moderator-dms).
- The repository README has no run instructions. The final presentation PDF, demo video link and ready-to-submit description were not verified in this review. See the [submission checklist](deliverables.md) for the remaining documents.

Legend: ✅ covered by design · ⚠️ risk or partly covered · ❌ gap, work needed

## MVP (sec. 3), the gate
Legend here: ✅ built and tested · ⚠️ built, not yet ready for the jury · ❌ missing.

| Requirement | Implementation and verification | Status |
|---|---|---|
| Text or URL input via a responsive web UI | Astro chat and production web API are connected. The API accepted live text and gov.pl URL checks. | ✅ |
| A second channel or demo adapter | `bun run bot:console` produced a live answer without a platform account. See the cross-channel evidence finding above. | ✅ |
| Detect one or more claims | `claim-extraction@6`, tests in `pipeline_test.ts` | ✅ |
| A described set with ≥2 source types; show the materials used | fact-checks (Google Fact Check), legal acts (Sejm ELI), official statistics (Eurostat, NBP, GUS), EUvsDisinfo as context; the list at `GET /api/v1/sources`; verified quotes and links in every answer | ✅ |
| Result + justification + strength + limitations | contract v1 ([response-contract](../product/response-contract.md)) | ✅ |
| Answer in Polish, plain language | always Polish, whatever the input or source language (decided 2026-11-22, [language policy](../product/response-contract.md#language-policy)) | ✅ |
| Log: question, time, sources, verdict | Masked check logging and retention are implemented with Deno KV and an in-memory fallback. Local KV tests cover cross-instance reads and session deletion. The public health endpoint confirms KV for source controls. Production check-log persistence was not inspected. | ⚠️ |
| Abstain without a fake answer | verdict rules in code; outages and missing keys → system states; tests | ✅ |
| End-to-end with no manual intervention | one pipeline; local live eval 98% end-to-end (run 3, [benchmark](../evaluation/benchmark.md)) | ✅ 2026-11-22: a live text check on the deployed API returned `status: ok`, verdict `fałszywe` with an NBP citation, 7.3 s, $0.0004. Still prove it in the demo video, and for the bot channel too |

## Behaviour (sec. 2) and technical requirements (sec. 5)
| Requirement | Our design | Status |
|---|---|---|
| Exactly 5 verdicts; failure, inability and clarification communicated separately | response contract A vs B | ✅ |
| Separate source material from the model's interpretation; title, publisher, date, link, excerpt | "Co mówią źródła" vs "Nasza ocena"; citations from the DB, quotes verified verbatim | ✅ |
| Strength from explicit factors | code: tier, recency, match, independence | ✅ |
| Notify a designated user on high-risk or repeated unanswered questions | See [moderator DMs](../architecture/api-reference.md#moderator-dms) for the local implementation and activation requirements. | ⚠️ |
| Prompt injection resistance | data boundary in every prompt, JSON-only models with no tools, `injection_signals` + regex scan, logged events | ✅ (needs ≥90% on our attack set) |
| Channel handling separate from verification; model swappable without a rebuild | `packages/core` + adapters (web, bot, eval); `MODEL_<STEP>` env; evidence routes and known-incident matchers injectable through `deps` and listed at `GET /api/v1/sources`; recipes and proving tests in [extensibility](../architecture/extensibility.md) (also the bonus item "architektura umożliwiająca podłączanie…") | ✅ tested (`pipeline_test.ts`, `core_test.ts`, `main_test.ts`) |
| Corpus ≥100 docs, ≥10 domains, ≥2 types, auditable source list | trusted-source catalog public at `GET /api/v1/sources` ([decision 008](../decisions/008-trusted-source-allowlist.md)); `alert-corpus.jsonl` is converted from the local source snapshot and built into `alert-corpus-index.json`; the API loads an in-memory BM25 index through `IndexedCorpusStore`; EUvsDisinfo stays outside the corpus | ⚠️ See the hostname count and licensing findings above. |
| Publication and retrieval timestamps; warn about archival material | `published_at`, `retrieved_at`; `archival_material` warning | ⚠️ The checked-in snapshot has records without a publication date. |
| Security: input validation, separated instructions, tool limits, secrets, rate limiting, event logging | all in the flow; `.env` + `.gitignore` | ✅ |
| Privacy: minimisation, PII masking, retention, deletable session | Masking rules, 30-day KV expiry, and `DELETE /api/v1/session/{id}` exist. Production deletion was not exercised. See [API reference](../architecture/api-reference.md). | ⚠️ |
| Observability: latency, model use, retrieval errors, abstentions, cost per answer | `meta` + `check_events`, OpenRouter `usage.cost` | ✅ |
| Accessibility: responsive, contrast, plain language | tone rules in the contract | ⚠️ UI and contrast still to be done and checked (WCAG AA) |
| Same result across channels | Shared verification core. The live smoke test agreed on verdict but returned different evidence sets. | ⚠️ |
| "Recommended" ≠ "escalated" | The contract exposes `none` and `recommended`. | ✅ |
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
| **No archiving of full content or images without a legal basis, license, retention, access control and deletion procedure** | The distributed corpus contains full source bodies. See the archiving finding above. | ⚠️ |

## Evaluation integrity (sec. 6)
| Requirement | Our design | Status |
|---|---|---|
| No test answers in prompts, no hardcoded examples | prompts use rules, and few-shot examples (if any) are synthetic | ✅ (rule 16) |
| Mandatory metrics | See [benchmark](../evaluation/benchmark.md) and the citation and channel findings above. | ⚠️ |
| Disclose unsupported cases | a "Czego nie obsługujemy" section | ❌ to write |

## Source coverage gaps (affect accuracy, not the gate)
- **Institutional statements** (nbp.pl, trybunal.gov.pl, ministries outside gov.pl): not ingested. Claims of the type "institution X announced…" will often end as `brak wystarczających dowodów`.
- **International politics** (e.g. US statements): our sources are mostly Polish and official. ClaimReview helps; consider whitehouse.gov or MSZ statements.
- Median text/URL latency is below 30 s in the [recorded benchmark](../evaluation/benchmark.md).

## Deliverables (sec. 4) and the regulamin
See the [submission checklist](deliverables.md). Review dependencies and source licenses against the [regulamin](regulamin.md) before submission.
