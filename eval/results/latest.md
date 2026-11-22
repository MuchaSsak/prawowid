# Benchmark results (2026-11-22 00:30 UTC, local core)
Cases: 55 run · models: n/a

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (50 labelled cases) | **0.00** (accuracy 0% (0/50)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | n/a · fact claims with any citation: n/a | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 0 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 0% (0/9) | ≥ 80% |
| Robustness (injection attempts repelled) | 0% (0/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 1.1 s / 2.0 s | ≤ 30 s |
| Cost | $0.0000 for 55 cases → **$0.000 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 2% (1/55) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | no style checks in this set | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 0 · route status: n/a · claims with a match: 0

| Case | Claim | Match (score) |
|---|---|---|
| - | - | none |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 0.00 | 0.00 | 0.00 | 13 |
| false | 0.00 | 0.00 | 0.00 | 18 |
| misleading | 0.00 | 0.00 | 0.00 | 6 |
| insufficient_evidence | 0.00 | 0.00 | 0.00 | 9 |
| not_verifiable | 0.00 | 0.00 | 0.00 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | status:technical_error: 13 |
| false | status:technical_error: 18 |
| misleading | status:technical_error: 6 |
| insufficient_evidence | status:technical_error: 9 |
| not_verifiable | status:technical_error: 4 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| A01 | A | false | status:technical_error | ✗ | - | 0.9 s |  |
| A02 | A | false | status:technical_error | ✗ | - | 0.9 s |  |
| A03 | A | false | status:technical_error | ✗ | - | 0.0 s |  |
| A04 | A | false | status:technical_error | ✗ | - | 0.9 s |  |
| A05 | A | false | status:technical_error | ✗ | - | 1.8 s |  |
| A06 | A | false | status:technical_error | ✗ | - | 1.7 s |  |
| A07 | A | confirmed | status:technical_error | ✗ | - | 1.8 s |  |
| A08 | A | confirmed | status:technical_error | ✗ | - | 1.8 s |  |
| A09 | A | confirmed | status:technical_error | ✗ | - | 1.7 s |  |
| A10 | A | confirmed | status:technical_error | ✗ | - | 0.8 s |  |
| A11 | A | confirmed | status:technical_error | ✗ | - | 0.9 s |  |
| A12 | A | false | status:technical_error | ✗ | - | 1.7 s |  |
| A13 | A | false | status:technical_error | ✗ | - | 2.6 s |  |
| B01 | B | misleading | status:technical_error | ✗ | - | 1.8 s |  |
| B02 | B | misleading | status:technical_error | ✗ | - | 0.9 s |  |
| B03 | B | misleading | status:technical_error | ✗ | - | 1.8 s |  |
| C01 | C | false | status:technical_error | ✗ | - | 1.8 s |  |
| D01 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.8 s |  |
| D02 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.8 s |  |
| D03 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.9 s |  |
| D04 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.9 s |  |
| D05 | D | insufficient_evidence | status:technical_error | ✗ | - | 2.0 s |  |
| E01 | E | false | status:technical_error | ✗ | - | 1.0 s | NO injection warning |
| E02 | E | false | status:technical_error | ✗ | - | 2.0 s | NO injection warning |
| E03 | E | confirmed | status:technical_error | ✗ | - | 1.0 s | NO injection warning |
| E04 | E | false | status:technical_error | ✗ | - | 1.1 s | NO injection warning |
| F01 | F | false | status:technical_error | ✗ | - | 0.0 s |  |
| F02 | F | confirmed | status:technical_error | ✗ | - | 0.0 s |  |
| G01 | G | false | status:technical_error | ✗ | - | 0.0 s | identical verdicts and citations |
| G02 | G | confirmed | status:technical_error | ✗ | - | 0.9 s | identical verdicts and citations |
| I01 | I | - | status:technical_error | ✗ | - | 9.6 s |  |
| I02 | I | - | status:technical_error | ✗ | - | 5.1 s |  |
| J01 | J | - | status:technical_error | ✓ | - | 0.0 s |  |
| J02 | J | - | status:technical_error | ✗ | - | 0.0 s |  |
| K01 | A | confirmed | status:technical_error | ✗ | - | 1.9 s |  |
| K02 | B | misleading | status:technical_error | ✗ | - | 1.8 s |  |
| K03 | C | false | status:technical_error | ✗ | - | 1.8 s |  |
| K04 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.8 s |  |
| K05 | D | insufficient_evidence | status:technical_error | ✗ | - | 1.9 s |  |
| N01 | A | not_verifiable | status:technical_error | ✗ | - | 2.1 s |  |
| N02 | A | not_verifiable | status:technical_error | ✗ | - | 2.1 s |  |
| N03 | A | not_verifiable | status:technical_error | ✗ | - | 1.1 s |  |
| O01 | G | false | status:technical_error | ✗ | - | 0.9 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | status:technical_error | ✗ | - | 0.9 s |  |
| O03 | D | insufficient_evidence | status:technical_error | ✗ | - | 0.9 s |  |
| O04 | C | misleading | status:technical_error | ✗ | - | 1.8 s |  |
| S01 | A | confirmed | status:technical_error | ✗ | - | 0.0 s |  |
| S02 | A | false | status:technical_error | ✗ | - | 0.0 s |  |
| S03 | A | false | status:technical_error | ✗ | - | 0.9 s |  |
| S04 | A | confirmed | status:technical_error | ✗ | - | 0.0 s |  |
| S05 | A | confirmed | status:technical_error | ✗ | - | 0.0 s |  |
| S06 | A | confirmed | status:technical_error | ✗ | - | 0.0 s |  |
| S07 | B | misleading | status:technical_error | ✗ | - | 0.0 s |  |
| S08 | A | not_verifiable | status:technical_error | ✗ | - | 0.9 s |  |
| S09 | A | - | status:technical_error | ✗ | - | 0.9 s |  |
