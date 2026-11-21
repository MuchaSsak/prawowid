# Tests and benchmark
What is tested, how each metric is computed, the latest results and the known gaps. Results are measured, not estimated. Code: `packages/core/test/`, `apps/api/main_test.ts`, `eval/`.

## Two layers
| Layer | Command | Cost | What it proves |
|---|---|---|---|
| Deterministic tests (100) | `bun run test` | **free**: model and source APIs are stubbed, zero external calls | the rules: no fabricated sources, abstention, conflicts, injection, PII never leaves, missing keys, contract v1, HTTP behaviour |
| Live benchmark (37 cases) | `bun run eval` (full, ~$0.04) · `bun run eval:quick` (6 cases, ~$0.005) · `bun run eval:remote` (deployed URL) | real OpenRouter + Google credits | the jury's metrics on real models and sources |

Run the full benchmark only before a demo, a submission or a prompt/model change; use `eval:quick` otherwise (user, 2026-11-21: keep credit use low).

### Deterministic tests
- `packages/core/test/pipeline_test.ts` (30): the whole pipeline with a scripted model and scripted sources (`harness.ts` replaces `fetch` and records every outbound call). One test per scenario or release check: A confirm/refute with verbatim citations · rejected invented quotes and invented claims · the model never sees source URLs · C conflict → abstain + `sources_conflict` · D no records → abstain without a 2nd LLM call · D vs J failed source → system state · J missing/rejected key, invalid JSON, 429 → Small fallback · E injection in input and in a source · privacy (e-mail, phone, PESEL absent from every outbound request and the log) · opinions → no lookups · inconsistent assessment → abstain · circular corroboration · partial · G cache parity web vs messaging · H never a false "queued" · session deletion · clarification · claim cap · I URL intake, robots.txt, SSRF via DNS · F image OCR, vision failure · input rejection.
- `packages/core/test/contract_test.ts` (21): every mock scenario and live outputs validate against the same v1 schema ([decision 006](../decisions/006-api-contract-v1-and-mock.md)).
- `packages/core/test/core_test.ts` (16): PII rules, quote matching, injection patterns, URL guard, EXIF strip, verdict rules, ELI title fragments.
- `apps/api/main_test.ts` (34): every route, all 18 mock scenarios over HTTP, missing-key path, malformed bodies, SSRF URLs, 413, rate limits per IP and per bot end user, CORS, 404s.

## Reference set (`eval/cases.json`)
37 synthetic-or-public cases written 2026-11-21: A 13 + 3 opinion/prediction, B 3, C 1, D 5, E 4, F 2 (generated screenshots in `eval/fixtures/`), G 2, I 2, J 2. **Assumption:** the gold labels are the agent's; a human should review them (open question). Rule 16: the set is used only by `eval/run.ts`, never in prompts. Prompt rules added after a run must be general (no case wording); the jury's hidden set will differ.
- C (real conflict) can't be produced reliably from live sources, so the conflict rule is proven by the stubbed test; the live C case checks abstention.
- H (moderator loop) is not built: disclosed, and the tests check we never claim "queued".

## Metric definitions (eval/run.ts)
- **Case prediction:** if the request status is not `ok`/`partial` → `status:<x>` (always wrong; a technical error never counts as an abstention). Otherwise the fact claims' verdicts aggregated worst-first: `false` > `misleading` > `insufficient_evidence` > `confirmed`; no fact claims → `not_verifiable` if an opinion was listed.
- **Macro-F1:** over the 5 verdict classes present in the gold labels.
- **Citation coverage:** decisive verdicts (confirmed/false/misleading) with ≥1 non-context citation. Also reported: fact claims with any citation.
- **Citation correctness:** human labels in `eval/labels/citations.json` (`"<case>|<source_id>|<claim id>": true|false`), filled from `eval/results/citations-review.csv`. Verbatim-in-source is 100% by construction (code rejects other quotes).
- **Abstention:** gold `insufficient_evidence` cases predicted as such.
- **Robustness:** E cases where the attacker's target verdict was not produced, the check completed and `injection_detected` was raised.
- **Latency:** client wall clock, median and p90, uncached text/URL cases. **Cost:** sum of `meta.cost_usd`, scaled to 100 checks.
- **End-to-end:** completed, valid v1 contract, case expectations met. **Channel consistency:** G cases re-sent as `channel: messaging` with another session; verdicts and citation IDs must match.

## Results
Full runs, local core, mistral-small-2603 (extraction) + mistral-large-2512 (assessment), 2026-11-21:

| Metric | Run 1 (baseline) | Run 2 (after fixes) | Target |
|---|---|---|---|
| Macro-F1 | 0.44 (accuracy 52%) | **0.66 (accuracy 79%)** | ≥ 0.75 |
| Citation coverage (decisive) | 100% (12/12) | **100% (20/20)** | ≥ 95% |
| Citation correctness | not labelled | not labelled (57 citations to review) | ≥ 85% |
| Abstention | 100% (6/6) | **100% (6/6)** | ≥ 80% |
| Robustness | 100% (4/4) | **100% (4/4)** | ≥ 90% |
| Latency median / p90 | 3.9 / 9.7 s | **7.8 / 10.2 s** | ≤ 30 s |
| Cost per 100 checks | $0.077 | **$0.107** | reported |
| End-to-end | 95% | **97%** (36/37) | 100% |
| Channel consistency | 100% | **100%** (2/2) | 100% |

Per class, run 2: false F1 0.93 (13/13 recall), not_verifiable 0.80, confirmed 0.77, insufficient_evidence ~0.6 (precision hurt by abstentions on true claims), **misleading 0.00** (0/3). Full table: `eval/results/latest.md`; raw data: `eval/results/*.json`.

Fixes between runs 1 and 2 (all general, none mentions a case): Sejm ELI title search works on literal title fragments built in code and ranks base acts above amendments; the extraction prompt treats causal and "secretly contains" claims as facts; a lone "misleading" passage no longer outranks a refutation with more independent origins; the eval harness gives missing-key cases their own cache. After run 2 (checked on 5 cases only, to save credits): connectors retry one transient failure; opinions are always listed; the assessment prompt treats official record fields as statements and older passages as context for later-period claims.

## Known gaps (ranked by impact on the score)
1. **`misleading` (scenario B) is never produced** on live data: the model splits "true premise + wrong conclusion" into two claims and the conclusion gets `insufficient_evidence` or `false`. Needs the explicit "misleading inference" handling from the pipeline §2 and an eval-driven prompt change.
2. **True claims abstain too often** (confirmed recall 0.63): old or loosely related fact-checks get labelled refuting or context next to an official record, which triggers the conflict rule.
3. Numeric claims have no route yet (GUS, NBP, Eurostat), so they always abstain.
4. Citation correctness is unmeasured until a human labels `citations-review.csv`.
5. Both live C cases and the gold labels are single-annotator.
