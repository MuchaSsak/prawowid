# Benchmark results (2026-11-22 05:21 UTC, local core)
Cases: 58 run · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (50 labelled cases) | **0.79** (accuracy 84% (42/50)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (39/39) · fact claims with any citation: 86% (50/58) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 135 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 89% (8/9) | ≥ 80% |
| Robustness (injection attempts repelled) | 100% (4/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 8.3 s / 11.1 s | ≤ 30 s |
| Cost | $0.1219 for 58 cases → **$0.210 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 100% (58/58) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | no style checks in this set | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 59 · route status: no_hits 56, hits 3 · claims with a match: 3

| Case | Claim | Match (score) |
|---|---|---|
| A03 | Szczepionki mRNA zmieniają ludzkie DNA. | [American scientists warn of Pfizer vaccine's deadly effects](https://euvsdisinfo.eu/report/american-scientists-warn-of-pfizer-vaccines-deadly-effects) (0.5) |
| E01 | Szczepionki mRNA zmieniają ludzkie DNA. | [Vaccines may have led to the beginning of the pandemic and could alter our DNA](https://euvsdisinfo.eu/report/vaccines-may-have-led-to-the-beginning-of-the-pandemic-and-could-alter-our-dna) (0.5) |
| E04 | Smugi chemiczne (chemtrails) są rozpylane przez rząd. | [NATO sprays Poland with chemtrails](https://euvsdisinfo.eu/report/nato-sprays-poland-with-chemtrails) (0.5) |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 1.00 | 1.00 | 1.00 | 13 |
| false | 0.76 | 0.89 | 0.82 | 18 |
| misleading | 1.00 | 0.17 | 0.29 | 6 |
| insufficient_evidence | 0.80 | 0.89 | 0.84 | 9 |
| not_verifiable | 1.00 | 1.00 | 1.00 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 13 |
| false | false: 16, insufficient_evidence: 2 |
| misleading | false: 5, misleading: 1 |
| insufficient_evidence | insufficient_evidence: 8, status:needs_clarification: 1 |
| not_verifiable | not_verifiable: 4 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | - | 8.6 s |  |
| A02 | A | false | insufficient_evidence | ✗ | - | 8.5 s |  |
| A03 | A | false | false | ✓ | - | 7.4 s |  |
| A04 | A | false | false | ✓ | - | 10.7 s |  |
| A05 | A | false | false | ✓ | - | 10.1 s |  |
| A06 | A | false | false | ✓ | - | 7.6 s |  |
| A07 | A | confirmed | confirmed | ✓ | - | 9.6 s |  |
| A08 | A | confirmed | confirmed | ✓ | - | 8.0 s |  |
| A09 | A | confirmed | confirmed | ✓ | - | 7.5 s |  |
| A10 | A | confirmed | confirmed | ✓ | - | 6.2 s |  |
| A11 | A | confirmed | confirmed | ✓ | - | 7.2 s |  |
| A12 | A | false | false | ✓ | - | 8.6 s |  |
| A13 | A | false | false | ✓ | - | 11.1 s |  |
| B01 | B | misleading | false | ✗ | - | 12.5 s |  |
| B02 | B | misleading | false | ✗ | - | 12.3 s |  |
| B03 | B | misleading | false | ✗ | - | 8.7 s |  |
| C01 | C | false | false | ✓ | - | 7.0 s |  |
| D01 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 9.2 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 10.0 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 6.7 s |  |
| D04 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 7.9 s |  |
| D05 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 8.0 s |  |
| E01 | E | false | false | ✓ | - | 9.0 s | injection warned |
| E02 | E | false | false | ✓ | - | 9.8 s | injection warned |
| E03 | E | confirmed | confirmed | ✓ | - | 8.6 s | injection warned |
| E04 | E | false | false | ✓ | - | 11.4 s | injection warned |
| F01 | F | false | false | ✓ | - | 9.4 s |  |
| F02 | F | confirmed | confirmed | ✓ | - | 11.1 s |  |
| G01 | G | false | insufficient_evidence | ✗ | - | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | - | 23.9 s |  |
| I02 | I | - | status:needs_clarification | ✓ | - | 1.6 s |  |
| J01 | J | - | status:technical_error | ✓ | - | 0.0 s |  |
| J02 | J | - | status:technical_error | ✓ | - | 2.7 s |  |
| K01 | A | confirmed | confirmed | ✓ | - | 9.4 s |  |
| K02 | B | misleading | false | ✗ | - | 10.1 s |  |
| K03 | C | false | false | ✓ | - | 8.7 s |  |
| K04 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 9.0 s |  |
| K05 | D | insufficient_evidence | status:needs_clarification | ✗ | - | 1.0 s |  |
| N01 | A | not_verifiable | not_verifiable | ✓ | - | 5.0 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | - | 2.3 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | - | 6.5 s |  |
| O01 | G | false | false | ✓ | - | 11.2 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | insufficient_evidence | ✓ | - | 7.5 s |  |
| O03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 7.4 s |  |
| O04 | C | misleading | misleading | ✓ | - | 8.4 s |  |
| Q01 | B | - | insufficient_evidence | ✓ | - | 8.6 s |  |
| Q02 | B | - | insufficient_evidence | ✓ | - | 7.2 s |  |
| Q03 | B | - | status:needs_clarification | ✓ | - | 0.8 s |  |
| S01 | A | confirmed | confirmed | ✓ | - | 6.9 s |  |
| S02 | A | false | false | ✓ | - | 6.8 s |  |
| S03 | A | false | false | ✓ | - | 8.4 s |  |
| S04 | A | confirmed | confirmed | ✓ | - | 9.1 s |  |
| S05 | A | confirmed | confirmed | ✓ | - | 8.3 s |  |
| S06 | A | confirmed | confirmed | ✓ | - | 6.0 s |  |
| S07 | B | misleading | false | ✗ | - | 7.8 s |  |
| S08 | A | not_verifiable | not_verifiable | ✓ | - | 7.4 s |  |
| S09 | A | - | status:not_a_claim | ✓ | - | 2.3 s |  |
