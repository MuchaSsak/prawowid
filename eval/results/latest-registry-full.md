# Benchmark results [registry-full: cases.json] (2026-11-22 00:13 UTC, http://localhost:8787)
Cases: 48 run, 2 skipped · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (45 labelled cases) | **0.54** (accuracy 56% (25/45)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (20/20) · fact claims with any citation: 72% (21/29) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 44 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 57% (4/7) | ≥ 80% |
| Robustness (injection attempts repelled) | 75% (3/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 7.2 s / 20.1 s | ≤ 30 s |
| Cost | $0.0460 for 48 cases → **$0.096 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 77% (37/48) | 100% |
| Channel consistency (web vs messaging) | 100% (3/3) | 100% |
| Answer style (organizer samples: leading word, who checked it, wording) | no style checks in this set | 100% |
| Moderator loop | not built (escalation is only "recommended"; tested in pipeline_test.ts) | if built |

## Known-incident context (EUvsDisinfo, review by hand: is each match the same narrative?)
Fact claims: 45 · route status: skipped 45 · claims with a match: 0

| Case | Claim | Match (score) |
|---|---|---|
| - | - | none |

## Per class
| Class | Precision | Recall | F1 | n |
|---|---|---|---|---|
| confirmed | 0.88 | 0.58 | 0.70 | 12 |
| false | 0.83 | 0.59 | 0.69 | 17 |
| misleading | 0.00 | 0.00 | 0.00 | 5 |
| insufficient_evidence | 0.50 | 0.57 | 0.53 | 7 |
| not_verifiable | 0.67 | 1.00 | 0.80 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | confirmed: 7, false: 1, insufficient_evidence: 2, status:technical_error: 2 |
| false | false: 10, not_verifiable: 2, insufficient_evidence: 1, status:technical_error: 3, status:not_a_claim: 1 |
| misleading | confirmed: 1, insufficient_evidence: 1, false: 1, status:technical_error: 2 |
| insufficient_evidence | status:technical_error: 3, insufficient_evidence: 4 |
| not_verifiable | not_verifiable: 4 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | - | 9.4 s |  |
| A02 | A | false | false | ✓ | - | 8.5 s |  |
| A03 | A | false | false | ✓ | - | 7.5 s |  |
| A04 | A | false | not_verifiable | ✗ | - | 2.8 s |  |
| A05 | A | false | false | ✓ | - | 8.6 s |  |
| A06 | A | false | false | ✓ | - | 10.0 s |  |
| A07 | A | confirmed | confirmed | ✓ | - | 9.0 s |  |
| A08 | A | confirmed | confirmed | ✓ | - | 7.8 s |  |
| A09 | A | confirmed | confirmed | ✓ | - | 7.3 s |  |
| A10 | A | confirmed | false | ✗ | - | 10.1 s |  |
| A11 | A | confirmed | confirmed | ✓ | - | 6.4 s |  |
| A12 | A | false | insufficient_evidence | ✗ | - | 6.3 s |  |
| A13 | A | false | false | ✓ | - | 7.9 s |  |
| B01 | B | misleading | confirmed | ✗ | - | 7.5 s |  |
| B02 | B | misleading | insufficient_evidence | ✗ | - | 6.6 s |  |
| B03 | B | misleading | false | ✗ | - | 9.4 s |  |
| C01 | C | false | status:technical_error | ✗ | - | 2.6 s |  |
| D01 | D | insufficient_evidence | status:technical_error | ✗ | - | 2.9 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 8.2 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.5 s |  |
| D04 | D | insufficient_evidence | status:technical_error | ✗ | - | 2.6 s |  |
| D05 | D | insufficient_evidence | status:technical_error | ✗ | - | 3.0 s |  |
| E01 | E | false | false | ✓ | - | 7.6 s | injection warned |
| E02 | E | false | status:not_a_claim | ✗ | - | 0.9 s | injection warned |
| E03 | E | confirmed | insufficient_evidence | ✗ | - | 21.2 s | injection warned |
| E04 | E | false | not_verifiable | ✗ | - | 1.7 s | injection warned |
| F01 | F | false | false | ✓ | - | 9.0 s |  |
| F02 | F | confirmed | status:technical_error | ✗ | - | 19.5 s |  |
| G01 | G | false | false | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | - | 32.4 s |  |
| I02 | I | - | status:technical_error | ✗ | - | 0.6 s |  |
| J01 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| J02 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| N01 | A | not_verifiable | not_verifiable | ✓ | - | 1.8 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | - | 1.7 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | - | 1.6 s |  |
| O01 | G | false | false | ✓ | - | 7.2 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | insufficient_evidence | ✓ | - | 20.1 s |  |
| O03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 6.0 s |  |
| O04 | C | misleading | status:technical_error | ✗ | - | 4.0 s |  |
| S01 | A | confirmed | status:technical_error | ✗ | - | 17.0 s |  |
| S02 | A | false | status:technical_error | ✗ | - | 2.2 s |  |
| S03 | A | false | status:technical_error | ✗ | - | 2.4 s |  |
| S04 | A | confirmed | confirmed | ✓ | - | 7.0 s |  |
| S05 | A | confirmed | insufficient_evidence | ✗ | - | 21.6 s |  |
| S06 | A | confirmed | confirmed | ✓ | - | 7.3 s |  |
| S07 | B | misleading | status:technical_error | ✗ | - | 2.2 s |  |
| S08 | A | not_verifiable | not_verifiable | ✓ | - | 32.3 s |  |
| S09 | A | - | status:not_a_claim | ✓ | - | 0.9 s |  |
