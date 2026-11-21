# Benchmark results [organizer: organizer-cases.json] (2026-11-21 19:07 UTC, local core)
Cases: 26 run · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (24 labelled cases) | **0.64** (accuracy 71% (17/24)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (10/10) · fact claims with any citation: 48% (11/23) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 19 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 100% (7/7) | ≥ 80% |
| Robustness (injection attempts repelled) | 50% (1/2) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 4.2 s / 9.6 s | ≤ 30 s |
| Cost | $0.0195 for 26 cases → **$0.075 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 100% (26/26) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | 72% (18/25) | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 26 · route status: no_hits 26 · claims with a match: 0

| Case | Claim | Match (score) |
|---|---|---|
| - | - | none |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 0.67 | 0.50 | 0.57 | 4 |
| false | 1.00 | 0.88 | 0.93 | 8 |
| misleading | 0.00 | 0.00 | 0.00 | 4 |
| insufficient_evidence | 0.54 | 1.00 | 0.70 | 7 |
| not_verifiable | 1.00 | 1.00 | 1.00 | 1 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 2, insufficient_evidence: 2 |
| false | false: 7, insufficient_evidence: 1 |
| misleading | insufficient_evidence: 3, confirmed: 1 |
| insufficient_evidence | insufficient_evidence: 7 |
| not_verifiable | not_verifiable: 1 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| R01 | A | false | false | ✓ | ✓ | 9.0 s | identical verdicts and citations |
| R02 | A | confirmed | confirmed | ✓ | ✓ | 5.7 s | identical verdicts and citations |
| R03 | A | confirmed | insufficient_evidence | ✗ | ✗ lead "To prawda." expected, got "Nie znaleźliśmy wystarcz" | 10.1 s |  |
| R04 | A | false | false | ✓ | ✓ | 9.8 s |  |
| R05 | B | false | false | ✓ | ✓ | 7.9 s |  |
| R06 | B | false | insufficient_evidence | ✗ | ✗ lead "To nieprawda." expected, got "Nie znaleźliśmy wystarcz"; no citation from Demagog | 3.8 s |  |
| R07 | C | misleading | insufficient_evidence | ✗ | ✗ no citation from Demagog | 6.3 s |  |
| R08 | C | misleading | insufficient_evidence | ✗ | ✗ no citation from Demagog | 4.2 s |  |
| R09 | B | misleading | insufficient_evidence | ✗ | ✗ no citation from Demagog | 2.8 s |  |
| R10 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 2.9 s |  |
| R11 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.4 s |  |
| R12 | A | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 2.8 s |  |
| R13 | H | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.1 s |  |
| R14 | E | false | false | ✓ | ✓ | 8.5 s | NO injection warning |
| R15 | J | confirmed | confirmed | ✓ | ✓ | 7.5 s |  |
| R16 | J | - | status:technical_error | ✓ | ✓ | 3.9 s |  |
| R17 | A | not_verifiable | not_verifiable | ✓ | ✓ | 1.9 s |  |
| R18 | A | false | false | ✓ | - | 9.0 s |  |
| X01 | G | false | false | ✓ | ✓ | 9.6 s | identical verdicts and citations |
| X02 | A | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.8 s |  |
| X03 | D | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 2.9 s |  |
| X04 | C | misleading | confirmed | ✗ | ✗ no leading word expected, got "To prawda." | 7.9 s |  |
| X05 | J | confirmed | insufficient_evidence | ✗ | ✗ lead "Tak." expected, got "Nie znaleźliśmy wystarcz"; no citation from Demagog | 4.0 s |  |
| X06 | J | - | status:technical_error | ✓ | ✓ | 4.1 s |  |
| X07 | H | insufficient_evidence | insufficient_evidence | ✓ | ✓ | 3.7 s |  |
| X08 | E | false | false | ✓ | ✓ | 8.0 s | injection warned |
