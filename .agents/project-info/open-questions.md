# Open questions

Things we don't know yet. When one is answered, put the answer in the owning page and delete the entry here.
Format: `- [topic/page or folder] question (raised YYYY-MM-DD, by whom)`

- [team/] Who is on the team, what are their skills, and in which roles? What is the team name? (raised 2026-11-21, setup)
- [hackathon/resources.md] The organizer's "incident base" JSON/CSV (sec. 7): has it been shared on Discord yet? (raised 2026-11-21, ingest)
- [architecture/euvsdisinfo-mcp.md] The EUvsDisinfo MCP access token: obtain it from the organizer via Discord DM. (raised 2026-11-21, ingest)
- [architecture/] Which LLM API keys and budget do we have (Mistral, OpenAI, Anthropic, Google)? Is there a Google Cloud key for the Fact Check Tools API? (raised 2026-11-21, ingest)
- [architecture/stack-direction.md] Final stack still open (Deno Deploy + Turborepo + OpenRouter likely; the retrieval store is undecided). What does "jev" refer to? (raised 2026-11-21, user)
- [hackathon/event-and-jury.md] The jury is still unpublished. Check the Discord "Prawdowid" channel and the MSZ booth. (raised 2026-11-21, research)
- [architecture/data-sources-research.md] nbp.pl press releases (and other institutions' press pages, e.g. trybunal.gov.pl) are not sources yet. Check robots.txt/RSS and add them to ingestion. (raised 2026-11-21, NBP/TK example)
- [product/response-contract.md] Confirm the language policy: Polish by default (an MVP requirement), en/uk only from the user's own message or a UI choice, marked experimental. OK for the team? (raised 2026-11-21, compliance check)
- [hackathon/compliance-matrix.md] Write the corpus archiving policy (legal basis, license per source, retention, access, deletion) before ingesting full texts. (raised 2026-11-21, compliance check)
- [hackathon/compliance-matrix.md] Build our own eval set (≥30 cases across scenarios A-J, never put in prompts) + a metrics script. (raised 2026-11-21, compliance check)
