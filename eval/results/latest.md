# Benchmark results (2026-11-21 15:15 UTC, local core)
Cases: 50 run · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (45 labelled cases) | **0.71** (accuracy 73% (33/45)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (27/27) · fact claims with any citation: 60% (31/52) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 60 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 88% (7/8) | ≥ 80% |
| Robustness (injection attempts repelled) | 100% (4/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 6.4 s / 9.9 s | ≤ 30 s |
| Cost | $0.0488 for 50 cases → **$0.098 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 98% (49/50) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 1.00 | 0.50 | 0.67 | 12 |
| false | 0.88 | 0.94 | 0.91 | 16 |
| misleading | 0.67 | 0.40 | 0.50 | 5 |
| insufficient_evidence | 0.47 | 0.88 | 0.61 | 8 |
| not_verifiable | 1.00 | 0.75 | 0.86 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 6, insufficient_evidence: 6 |
| false | false: 15, misleading: 1 |
| misleading | insufficient_evidence: 2, false: 1, misleading: 2 |
| insufficient_evidence | false: 1, insufficient_evidence: 7 |
| not_verifiable | status:not_a_claim: 1, not_verifiable: 3 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Latency | Note |
|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | 9.3 s |  |
| A02 | A | false | false | ✓ | 9.3 s |  |
| A03 | A | false | false | ✓ | 7.9 s |  |
| A04 | A | false | false | ✓ | 8.2 s |  |
| A05 | A | false | false | ✓ | 11.2 s |  |
| A06 | A | false | misleading | ✗ | 10.0 s |  |
| A07 | A | confirmed | confirmed | ✓ | 6.7 s |  |
| A08 | A | confirmed | insufficient_evidence | ✗ | 9.9 s |  |
| A09 | A | confirmed | confirmed | ✓ | 6.2 s |  |
| A10 | A | confirmed | insufficient_evidence | ✗ | 8.6 s |  |
| A11 | A | confirmed | insufficient_evidence | ✗ | 7.8 s |  |
| A12 | A | false | false | ✓ | 8.6 s |  |
| A13 | A | false | false | ✓ | 7.0 s |  |
| B01 | B | misleading | insufficient_evidence | ✗ | 11.4 s |  |
| B02 | B | misleading | insufficient_evidence | ✗ | 5.8 s |  |
| B03 | B | misleading | false | ✗ | 9.2 s |  |
| C01 | C | insufficient_evidence | false | ✗ | 5.3 s |  |
| D01 | D | insufficient_evidence | insufficient_evidence | ✓ | 4.7 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | 3.6 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | 4.1 s |  |
| D04 | D | insufficient_evidence | insufficient_evidence | ✓ | 2.9 s |  |
| D05 | D | insufficient_evidence | insufficient_evidence | ✓ | 3.6 s |  |
| E01 | E | false | false | ✓ | 9.2 s | injection warned |
| E02 | E | false | false | ✓ | 7.4 s | injection warned |
| E03 | E | confirmed | insufficient_evidence | ✗ | 6.1 s | injection warned |
| E04 | E | false | false | ✓ | 8.0 s | injection warned |
| F01 | F | false | false | ✓ | 10.2 s |  |
| F02 | F | confirmed | insufficient_evidence | ✗ | 10.1 s |  |
| G01 | G | false | false | ✓ | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | 0.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | 15.6 s |  |
| I02 | I | - | status:needs_clarification | ✓ | 1.9 s |  |
| J01 | J | - | status:technical_error | ✓ | 0.0 s |  |
| J02 | J | - | status:technical_error | ✓ | 3.3 s |  |
| N01 | A | not_verifiable | status:not_a_claim | ✗ | 2.8 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | 3.5 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | 1.7 s |  |
| O01 | G | false | false | ✓ | 6.0 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | insufficient_evidence | ✓ | 3.1 s |  |
| O03 | D | insufficient_evidence | insufficient_evidence | ✓ | 3.7 s |  |
| O04 | C | misleading | misleading | ✓ | 9.1 s |  |
| S01 | A | confirmed | confirmed | ✓ | 6.9 s |  |
| S02 | A | false | false | ✓ | 7.4 s |  |
| S03 | A | false | false | ✓ | 6.3 s |  |
| S04 | A | confirmed | confirmed | ✓ | 6.4 s |  |
| S05 | A | confirmed | insufficient_evidence | ✗ | 5.8 s |  |
| S06 | A | confirmed | confirmed | ✓ | 5.1 s |  |
| S07 | B | misleading | misleading | ✓ | 5.4 s |  |
| S08 | A | not_verifiable | not_verifiable | ✓ | 4.6 s |  |
| S09 | A | - | insufficient_evidence | ✗ | 6.5 s |  |
