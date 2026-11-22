# Benchmark results [registry-full: cases.json] (2026-11-22 00:33 UTC, http://localhost:8787)
Cases: 48 run, 2 skipped · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (45 labelled cases) | **0.63** (accuracy 73% (33/45)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (28/28) · fact claims with any citation: 65% (31/48) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 71 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 100% (7/7) | ≥ 80% |
| Robustness (injection attempts repelled) | 100% (4/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 6.3 s / 16.6 s | ≤ 30 s |
| Cost | $0.0515 for 48 cases → **$0.107 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 98% (47/48) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | no style checks in this set | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 49 · route status: skipped 49 · claims with a match: 0

| Case | Claim | Match (score) |
|---|---|---|
| - | - | none |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 0.88 | 0.58 | 0.70 | 12 |
| false | 0.83 | 0.88 | 0.86 | 17 |
| misleading | 0.00 | 0.00 | 0.00 | 5 |
| insufficient_evidence | 0.54 | 1.00 | 0.70 | 7 |
| not_verifiable | 0.80 | 1.00 | 0.89 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 7, insufficient_evidence: 4, status:technical_error: 1 |
| false | false: 15, insufficient_evidence: 1, not_verifiable: 1 |
| misleading | false: 3, insufficient_evidence: 1, confirmed: 1 |
| insufficient_evidence | insufficient_evidence: 7 |
| not_verifiable | not_verifiable: 4 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | - | 11.0 s |  |
| A02 | A | false | false | ✓ | - | 6.8 s |  |
| A03 | A | false | false | ✓ | - | 9.8 s |  |
| A04 | A | false | false | ✓ | - | 8.0 s |  |
| A05 | A | false | false | ✓ | - | 8.7 s |  |
| A06 | A | false | false | ✓ | - | 7.2 s |  |
| A07 | A | confirmed | confirmed | ✓ | - | 8.2 s |  |
| A08 | A | confirmed | insufficient_evidence | ✗ | - | 8.0 s |  |
| A09 | A | confirmed | confirmed | ✓ | - | 7.4 s |  |
| A10 | A | confirmed | insufficient_evidence | ✗ | - | 4.6 s |  |
| A11 | A | confirmed | insufficient_evidence | ✗ | - | 6.5 s |  |
| A12 | A | false | false | ✓ | - | 5.3 s |  |
| A13 | A | false | insufficient_evidence | ✗ | - | 7.9 s |  |
| B01 | B | misleading | false | ✗ | - | 12.1 s |  |
| B02 | B | misleading | insufficient_evidence | ✗ | - | 6.2 s |  |
| B03 | B | misleading | false | ✗ | - | 7.0 s |  |
| C01 | C | false | false | ✓ | - | 10.9 s |  |
| D01 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 3.5 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.5 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.2 s |  |
| D04 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.3 s |  |
| D05 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.3 s |  |
| E01 | E | false | false | ✓ | - | 8.0 s | injection warned |
| E02 | E | false | false | ✓ | - | 6.3 s | injection warned |
| E03 | E | confirmed | confirmed | ✓ | - | 5.9 s | injection warned |
| E04 | E | false | not_verifiable | ✗ | - | 17.2 s | injection warned |
| F01 | F | false | false | ✓ | - | 7.0 s |  |
| F02 | F | confirmed | insufficient_evidence | ✗ | - | 9.9 s |  |
| G01 | G | false | false | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | - | 15.3 s |  |
| I02 | I | - | status:needs_clarification | ✓ | - | 16.6 s |  |
| J01 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| J02 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| N01 | A | not_verifiable | not_verifiable | ✓ | - | 1.9 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | - | 1.8 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | - | 1.5 s |  |
| O01 | G | false | false | ✓ | - | 22.1 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | insufficient_evidence | ✓ | - | 3.4 s |  |
| O03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 17.2 s |  |
| O04 | C | misleading | confirmed | ✗ | - | 6.2 s |  |
| S01 | A | confirmed | confirmed | ✓ | - | 5.8 s |  |
| S02 | A | false | false | ✓ | - | 6.0 s |  |
| S03 | A | false | false | ✓ | - | 50.2 s |  |
| S04 | A | confirmed | confirmed | ✓ | - | 5.2 s |  |
| S05 | A | confirmed | status:technical_error | ✗ | - | 2.7 s |  |
| S06 | A | confirmed | confirmed | ✓ | - | 5.6 s |  |
| S07 | B | misleading | false | ✗ | - | 5.1 s |  |
| S08 | A | not_verifiable | not_verifiable | ✓ | - | 2.9 s |  |
| S09 | A | - | status:not_a_claim | ✓ | - | 0.7 s |  |
