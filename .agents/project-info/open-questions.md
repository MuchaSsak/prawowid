# Open questions

Things we don't know yet. When one is answered, put the answer in the owning page and delete the entry here.
Format: `- [topic/page or folder] question (raised YYYY-MM-DD, by whom)`

- [team/] Who is on the team, what are their skills, and in which roles? What is the team name? (raised 2026-11-21, setup)
- [hackathon/resources.md] The organizer's "incident base" JSON/CSV (sec. 7): has it been shared on Discord yet? (raised 2026-11-21, ingest)
- [architecture/euvsdisinfo-mcp.md] The EUvsDisinfo token was received (in .env), but the server rejects it: 401 "Unauthorized: Invalid API key" (tested 2026-11-21 with Bearer as in the how-to, plus x-api-key and a raw Authorization header; retested 13:33 UTC with the current .env value, 82 chars, no quotes, spaces or prefix: still 401). Ask the organizer whether it is active or was copied in full, or request our own access from EUvsDisinfo (see the euvsdisinfo-mcp page). (raised 2026-11-21, ingest)
- [architecture/verification-pipeline.md] Claim cap conflict after merging PR #1: prompts/claim-extraction.md says at most 8 claims, the pipeline says 12. Which one? (raised 2026-11-21, merge)
- [prompts/evidence-assessment.md] After PR #1 the sufficiency rule differs: the prompt says "one clear official source or a fact-check is enough", the pipeline (section 4-5) says a fact-check counts only through its demonstrated evidence and secondary sources need two independent origins. Align the prompt or the pipeline? (raised 2026-11-21, lint)
- [product/response-contract.md] Result states differ from the pipeline after PR #1: the contract has `input_rejected`, `not_a_claim`, `rate_limited`, `source_unavailable`; the pipeline has `rejected`, `not_processed` and partial/failed request states, plus a third moderator status ("Moderator przyjął zgłoszenie"). Which set is canonical? (raised 2026-11-21, lint)
- [decisions/001-private-logs-schema.md] Retention conflict after PR #1: decision 001 says 30 days, verification-pipeline section 7 proposes 7 days for session-linked checks. Which one? (raised 2026-11-21, lint)
- [decisions/002-single-llm-pass.md] Fabian's PR #2 (merged 2026-11-21) proposed a second, independent verifier for material prose and sending only approved public images to the vision model (private or uploaded screenshots get a paste-text fallback). The user kept decision 002 in the merge: no second verifier, every image goes through the vision model with the OCR text redacted afterwards. Fabian to confirm, or bring new information to reopen 002. (raised 2026-11-21, merge)
- [architecture/] Which LLM API keys and budget do we have (Mistral, OpenAI, Anthropic, Google)? Is there a Google Cloud key for the Fact Check Tools API? (raised 2026-11-21, ingest)
- [architecture/stack-direction.md] Final stack still open (Deno Deploy + Turborepo + OpenRouter likely; the retrieval store is undecided). What does "jev" refer to? (raised 2026-11-21, user)
- [hackathon/event-and-jury.md] The jury is still unpublished. Check the Discord "Prawdowid" channel and the MSZ booth. (raised 2026-11-21, research)
- [architecture/data-sources-research.md] nbp.pl press releases (and other institutions' press pages, e.g. trybunal.gov.pl) are not sources yet. Check robots.txt/RSS and add them to ingestion. (raised 2026-11-21, NBP/TK example)
- [product/response-contract.md] Confirm the language policy: Polish by default (an MVP requirement), en/uk only from the user's own message or a UI choice, marked experimental. OK for the team? (raised 2026-11-21, compliance check)
- [hackathon/compliance-matrix.md] Write the corpus archiving policy (legal basis, license per source, retention, access, deletion) before ingesting full texts. (raised 2026-11-21, compliance check)
- [hackathon/compliance-matrix.md] Build our own eval set (≥30 cases across scenarios A-J, never put in prompts) + a metrics script. (raised 2026-11-21, compliance check)
