# Benchmark results [organizer: organizer-cases.json] (2026-11-21 19:17 UTC, local core)
Cases: 29 run · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (26 labelled cases) | **0.62** (accuracy 65% (17/26)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (9/9) · fact claims with any citation: 44% (11/25) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 19 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 100% (8/8) | ≥ 80% |
| Robustness (injection attempts repelled) | 50% (1/2) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 4.2 s / 9.7 s | ≤ 30 s |
| Cost | $0.0234 for 29 cases → **$0.081 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 100% (29/29) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | 71% (20/28) | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 27 · route status: no_hits 26, hits 1 · claims with a match: 1

| Case | Claim | Match (score) |
|---|---|---|
| R09 | Greta Thunberg wyśmiewała protesty klimatyczne w Niemczech. | ["Thunberg kids" are twisting facts: man has nothing to do with climate change](https://euvsdisinfo.eu/report/thunberg-kids-are-twisting-facts-man-has-nothing-to-do-with-climate-change) (0.5) |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 1.00 | 0.33 | 0.50 | 3 |
| false | 1.00 | 0.56 | 0.71 | 9 |
| misleading | 0.67 | 0.40 | 0.50 | 5 |
| insufficient_evidence | 0.53 | 1.00 | 0.70 | 8 |
| not_verifiable | 0.50 | 1.00 | 0.67 | 1 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 1, insufficient_evidence: 1, misleading: 1 |
| false | false: 5, insufficient_evidence: 3, not_verifiable: 1 |
| misleading | misleading: 2, insufficient_evidence: 3 |
| insufficient_evidence | insufficient_evidence: 8 |
| not_verifiable | not_verifiable: 1 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| R01 | A | false | false | ✓ | ✓ | 7.8 s | identical verdicts and citations |
| R02 | A | confirmed | confirmed | ✓ | ✓ | 10.8 s | identical verdicts and citations |
| R03 | A | confirmed | insufficient_evidence | ✗ | ✗ lead "To prawda." expected, got "Demagog ocenia to twierd" | 10.8 s |  |
| R04 | A | false | insufficient_evidence | ✗ | ✗ lead "To nieprawda." expected, got "Nie znaleźliśmy wystarcz"; no citation from Demagog | 7.8 s |  |
| R05 | B | false | false | ✓ | ✓ | 7.3 s |  |
| R06 | B | false | insufficient_evidence | ✗ | ✗ lead "To nieprawda." expected, got "Nie znaleźliśmy wystarcz"; no citation from Demagog | 3.5 s |  |
| R07 | C | misleading | misleading | ✓ | ✗ no citation from Demagog | 7.2 s |  |
| R08 | C | misleading | insufficient_evidence | ✗ | ✗ no citation from Demagog | 3.2 s |  |
| R09 | B | misleading | insufficient_evidence | ✗ | ✗ no citation from Demagog | 2.7 s |  |
| R10 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.3 s |  |
| R11 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.6 s |  |
| R12 | A | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.1 s |  |
| R13 | H | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.5 s |  |
| R14 | E | false | false | ✓ | ✓ | 7.6 s | NO injection warning |
| R15 | J | confirmed | misleading | ✗ | ✓ | 9.0 s |  |
| R16 | J | - | status:technical_error | ✓ | ✓ | 3.3 s |  |
| R17 | A | not_verifiable | not_verifiable | ✓ | ✓ | 1.6 s |  |
| R18 | A | false | not_verifiable | ✗ | - | 3.3 s |  |
| X01 | G | false | false | ✓ | ✓ | 7.7 s | identical verdicts and citations |
| X02 | A | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 4.2 s |  |
| X03 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 2.8 s |  |
| X04 | C | misleading | misleading | ✓ | ✗ no leading word expected, got "To nieprawda." | 7.7 s |  |
| X05 | J | false | insufficient_evidence | ✗ | ✗ lead "Tak." expected, got "Nie znaleźliśmy weryfika"; no citation from Demagog; missing text "sprawdził" | 3.6 s |  |
| X06 | J | - | status:technical_error | ✓ | ✓ | 3.4 s |  |
| X07 | H | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 4.4 s |  |
| X08 | E | false | false | ✓ | ✓ | 9.3 s | injection warned |
| X09 | C | misleading | insufficient_evidence | ✗ | ✓ | 9.7 s |  |
| X10 | H | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 6.0 s |  |
| X11 | A | - | insufficient_evidence | ✓ | ✓ | 3.4 s |  |
