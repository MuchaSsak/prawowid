# Review: Pavel's architecture proposal (2026-11-21)
Assessment of a teammate's draft "PRAWOWID - propozycja architektury, kolejnych kroków i przepływu pracy" against what is already built and decided. Source: [sources/2026-11-21-pavel-architecture-proposal.txt](../sources/2026-11-21-pavel-architecture-proposal.txt). Reviewed 2026-11-22 at the user's request.

## Where it agrees with the project (keep)
- The model never writes a citation; quotes come from stored fragments; sources and metadata stay apart from interpretation ([hard constraints](../rules/hard-constraints.md), [verification-pipeline](verification-pipeline.md)).
- Google Fact Check is a supporting route, not a similarity engine; a publisher's presence alone is never a verdict.
- Demagog only within robots.txt and its license, no protection bypass ([decision 008](../decisions/008-trusted-source-allowlist.md)).
- Per-document provenance (publisher, license, dates, hashes) and a collector that dedups, diffs and reports errors.
- Prioritise disinformation-relevant sources over "broad public data" (GDDKiA, PAA monitoring, GIOŚ are demo-grade, not FIMI evidence).
- The test list (jury cases, injection, citation, freshness, conflicting sources, channel consistency, missing key, end-to-end).

## New and worth adopting
- **Hybrid retrieval.** `scripts/retrieval.py` is vector-only (`embedding <=> query`). Exact names, numbers and quotes need lexical search too: add Postgres full-text or `pg_trgm` and fuse ranks (RRF). Note: stock Postgres has no Polish stemmer, so use `simple` + `unaccent` or trigram similarity unless a Polish dictionary is installed.
- **A common document schema** with `publisher`, `license`, `source_type`, hashes. The Data repo's records lack most of these; the JSON → ingest converter ([decision 012](../decisions/012-source-ingestion.md)) should fill them from a per-source table.
- **Source tiers for the demo:** official + fact-check (A, B) first, broad public data (C) only as illustration.

## Conflicts with what is built or decided
| Proposal | Already decided / built | Suggested resolution |
|---|---|---|
| 6 outcomes incl. "awaria / potrzebna doprecyzacja" | 5 verdicts + separate system states; the brief requires errors and "clarify" never to look like verdicts ([response-contract](../product/response-contract.md)) | keep the contract |
| New API `POST /verify`, `GET /checks/{id}`, `/evidence`, `/moderation-cases` | frozen contract v1, `POST /api/v1/check` ([decision 006](../decisions/006-api-contract-v1-and-mock.md)) | add `GET /api/v1/checks/{id}` (+ evidence) as additive v1 routes if needed; no rename |
| Cron every 15-60 min (RSO, CERT, RCB, GIS, PAA) | user: no periodic recording loop of any kind (2026-11-22) | one batch refresh before the demo; truly live data through connectors at check time |
| "Confirmed: at least one, preferably 2 independent sources" | tier rule: `official`/`factcheck` alone; `media` needs a second independent origin ([decision 008](../decisions/008-trusted-source-allowlist.md)) | keep the tier rule (more precise) |
| Re-rank by recency | scope matching: evidence must match the claim's time and place; older sources become context, not proof ([verification-pipeline](verification-pipeline.md)) | rank by fit to the claim's date window, not by newness |
| Demagog "may be unstable behind Cloudflare" | measured: 3,812 of 3,828 pages with an honest UA; 3,545 records (3 years) in the Data repo | outdated, no action |
| `chunks[]` inside the document | Pavel's own pgvector schema keeps `chunks` as a table | keep the table |
| WWW + Discord as two channels | web + one bot for Discord, WhatsApp, Messenger ([messaging-bot](messaging-bot.md)) | already covered |

## Not covered by the proposal
EUvsDisinfo known-narrative matching is already live via MCP; Sejm ELI, NBP, Eurostat and GUS are live routes; PII masking, the check log, retention and session deletion exist ([codebase](codebase.md)). The proposal reads as a plan from scratch, so its step list should be mapped onto these pieces instead of rebuilt.
