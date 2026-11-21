# Benchmark results (2026-11-21 14:42 UTC, local core)
Cases: 37 run · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (33 labelled cases) | **0.66** (accuracy 79% (26/33)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (20/20) · fact claims with any citation: 59% (22/37) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 57 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 100% (6/6) | ≥ 80% |
| Robustness (injection attempts repelled) | 100% (4/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 7.8 s / 10.2 s | ≤ 30 s |
| Cost | $0.0397 for 37 cases → **$0.107 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 97% (36/37) | 100% |
| Channel consistency (web vs messaging) | 100% (2/2) | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 1.00 | 0.63 | 0.77 | 8 |
| false | 0.87 | 1.00 | 0.93 | 13 |
| misleading | 0.00 | 0.00 | 0.00 | 3 |
| insufficient_evidence | 0.67 | 1.00 | 0.80 | 6 |
| not_verifiable | 1.00 | 0.67 | 0.80 | 3 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 5, insufficient_evidence: 2, status:technical_error: 1 |
| false | false: 13 |
| misleading | false: 2, insufficient_evidence: 1 |
| insufficient_evidence | insufficient_evidence: 6 |
| not_verifiable | status:not_a_claim: 1, not_verifiable: 2 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Latency | Note |
|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | 9.9 s |  |
| A02 | A | false | false | ✓ | 8.0 s |  |
| A03 | A | false | false | ✓ | 10.5 s |  |
| A04 | A | false | false | ✓ | 8.1 s |  |
| A05 | A | false | false | ✓ | 9.2 s |  |
| A06 | A | false | false | ✓ | 7.9 s |  |
| A07 | A | confirmed | confirmed | ✓ | 8.7 s |  |
| A08 | A | confirmed | confirmed | ✓ | 10.2 s |  |
| A09 | A | confirmed | confirmed | ✓ | 8.8 s |  |
| A10 | A | confirmed | insufficient_evidence | ✗ | 9.4 s |  |
| A11 | A | confirmed | status:technical_error | ✗ | 4.2 s |  |
| A12 | A | false | false | ✓ | 7.2 s |  |
| A13 | A | false | false | ✓ | 9.3 s |  |
| B01 | B | misleading | false | ✗ | 12.3 s |  |
| B02 | B | misleading | insufficient_evidence | ✗ | 5.3 s |  |
| B03 | B | misleading | false | ✗ | 8.4 s |  |
| C01 | C | insufficient_evidence | insufficient_evidence | ✓ | 2.9 s |  |
| D01 | D | insufficient_evidence | insufficient_evidence | ✓ | 4.3 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | 4.6 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | 3.4 s |  |
| D04 | D | insufficient_evidence | insufficient_evidence | ✓ | 2.9 s |  |
| D05 | D | insufficient_evidence | insufficient_evidence | ✓ | 3.5 s |  |
| E01 | E | false | false | ✓ | 8.8 s | injection warned |
| E02 | E | false | false | ✓ | 9.4 s | injection warned |
| E03 | E | confirmed | confirmed | ✓ | 7.8 s | injection warned |
| E04 | E | false | false | ✓ | 7.3 s | injection warned |
| F01 | F | false | false | ✓ | 10.5 s |  |
| F02 | F | confirmed | insufficient_evidence | ✗ | 11.4 s |  |
| G01 | G | false | false | ✓ | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | 0.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | 16.5 s |  |
| I02 | I | - | status:needs_clarification | ✓ | 2.1 s |  |
| J01 | J | - | status:technical_error | ✓ | 0.0 s |  |
| J02 | J | - | status:technical_error | ✓ | 3.2 s |  |
| N01 | A | not_verifiable | status:not_a_claim | ✗ | 1.2 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | 3.3 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | 2.7 s |  |
