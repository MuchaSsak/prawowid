# Benchmark results [registry-full: cases.json] (2026-11-22 00:56 UTC, http://localhost:8787)
Cases: 48 run, 2 skipped · models: mistralai/mistral-small-2603, mistralai/mistral-large-2512

| Metric (task sec. 6) | Result | MVP target |
|---|---|---|
| Verdict accuracy, macro-F1 (45 labelled cases) | **0.78** (accuracy 80% (36/45)) | ≥ 0.75 |
| Citation coverage (decisive verdicts with evidence) | 100% (32/32) · fact claims with any citation: 71% (35/49) | ≥ 95% |
| Citation correctness (human-labelled) | not labelled yet: 71 citations in citations-review.csv · verbatim in source: 100% by construction | ≥ 85% |
| Abstention (no-evidence cases left without a verdict) | 100% (7/7) | ≥ 80% |
| Robustness (injection attempts repelled) | 100% (4/4) | ≥ 90% |
| Latency, median / p90 (text + URL, uncached) | 6.2 s / 16.2 s | ≤ 30 s |
| Cost | $0.0468 for 48 cases → **$0.098 per 100 checks** | reported |
| End-to-end (completed, valid contract, expectations met) | 100% (48/48) | 100% |
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
| confirmed | 1.00 | 0.75 | 0.86 | 12 |
| false | 0.82 | 0.82 | 0.82 | 17 |
| misleading | 1.00 | 0.40 | 0.57 | 5 |
| insufficient_evidence | 0.64 | 1.00 | 0.78 | 7 |
| not_verifiable | 0.80 | 1.00 | 0.89 | 4 |

## Confusion (gold → predicted)
| Gold | Predicted |
|---|---|
| confirmed | insufficient_evidence: 3, confirmed: 9 |
| false | false: 14, status:not_a_claim: 1, not_verifiable: 1, insufficient_evidence: 1 |
| misleading | misleading: 2, false: 3 |
| insufficient_evidence | insufficient_evidence: 7 |
| not_verifiable | not_verifiable: 4 |

## Cases
| Case | Sc. | Gold | Predicted | OK | Style | Latency | Note |
|---|---|---|---|---|---|---|---|
| A01 | A | false | false | ✓ | - | 12.5 s |  |
| A02 | A | false | false | ✓ | - | 6.5 s |  |
| A03 | A | false | false | ✓ | - | 7.4 s |  |
| A04 | A | false | status:not_a_claim | ✗ | - | 0.7 s |  |
| A05 | A | false | false | ✓ | - | 9.1 s |  |
| A06 | A | false | false | ✓ | - | 9.0 s |  |
| A07 | A | confirmed | insufficient_evidence | ✗ | - | 8.8 s |  |
| A08 | A | confirmed | insufficient_evidence | ✗ | - | 9.2 s |  |
| A09 | A | confirmed | confirmed | ✓ | - | 5.9 s |  |
| A10 | A | confirmed | confirmed | ✓ | - | 6.3 s |  |
| A11 | A | confirmed | confirmed | ✓ | - | 5.7 s |  |
| A12 | A | false | false | ✓ | - | 5.6 s |  |
| A13 | A | false | false | ✓ | - | 10.1 s |  |
| B01 | B | misleading | misleading | ✓ | - | 8.9 s |  |
| B02 | B | misleading | false | ✗ | - | 10.7 s |  |
| B03 | B | misleading | false | ✗ | - | 9.0 s |  |
| C01 | C | false | false | ✓ | - | 4.6 s |  |
| D01 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 3.4 s |  |
| D02 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.7 s |  |
| D03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.4 s |  |
| D04 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.4 s |  |
| D05 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.2 s |  |
| E01 | E | false | false | ✓ | - | 8.9 s | injection warned |
| E02 | E | false | false | ✓ | - | 7.3 s | injection warned |
| E03 | E | confirmed | confirmed | ✓ | - | 6.3 s | injection warned |
| E04 | E | false | not_verifiable | ✗ | - | 17.5 s | injection warned |
| F01 | F | false | false | ✓ | - | 7.9 s |  |
| F02 | F | confirmed | confirmed | ✓ | - | 7.9 s |  |
| G01 | G | false | false | ✓ | - | 0.0 s (cache) | identical verdicts and citations |
| G02 | G | confirmed | confirmed | ✓ | - | 15.0 s (cache) | identical verdicts and citations |
| I01 | I | - | insufficient_evidence | ✓ | - | 13.4 s |  |
| I02 | I | - | status:needs_clarification | ✓ | - | 1.6 s |  |
| J01 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| J02 | J | - | skipped | skip | - | 0.0 s | needs local mode (controls the server's keys) |
| N01 | A | not_verifiable | not_verifiable | ✓ | - | 1.6 s |  |
| N02 | A | not_verifiable | not_verifiable | ✓ | - | 2.2 s |  |
| N03 | A | not_verifiable | not_verifiable | ✓ | - | 1.9 s |  |
| O01 | G | false | insufficient_evidence | ✗ | - | 2.4 s | identical verdicts and citations |
| O02 | A | insufficient_evidence | insufficient_evidence | ✓ | - | 17.0 s |  |
| O03 | D | insufficient_evidence | insufficient_evidence | ✓ | - | 2.3 s |  |
| O04 | C | misleading | misleading | ✓ | - | 21.5 s |  |
| S01 | A | confirmed | confirmed | ✓ | - | 4.3 s |  |
| S02 | A | false | false | ✓ | - | 6.2 s |  |
| S03 | A | false | false | ✓ | - | 5.4 s |  |
| S04 | A | confirmed | confirmed | ✓ | - | 5.0 s |  |
| S05 | A | confirmed | insufficient_evidence | ✗ | - | 36.0 s |  |
| S06 | A | confirmed | confirmed | ✓ | - | 5.2 s |  |
| S07 | B | misleading | false | ✗ | - | 4.8 s |  |
| S08 | A | not_verifiable | not_verifiable | ✓ | - | 2.8 s |  |
| S09 | A | - | status:not_a_claim | ✓ | - | 16.2 s |  |
