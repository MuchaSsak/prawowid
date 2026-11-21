# Wiki log

Append-only. Format: `## [YYYY-MM-DD] <ingest|update|decision|lint|restructure> | <summary>`

## [2026-11-21] restructure | wiki skeleton created: topic folders, index, conventions, routing table in AGENTS.md
## [2026-11-21] restructure | migrated to tool-agnostic layout: AGENTS.md (CLAUDE.md imports it), wiki moved to .agents/project-info, skills to .agents/skills with Claude shims
## [2026-11-21] ingest | task PDFs, regulamin, EUvsDisinfo how-to and Discord sources ingested; research pages added (event-and-jury, jury-insights, data-sources, technical-approach)
## [2026-11-21] update | data-sources-research corrected: dane.gov.pl raised to P1; added GUS BDL, NBP, Eurostat and Sejm APIs (verified live); two retrieval modes (indexed corpus + live tools)
## [2026-11-21] update | added architecture/verification-pipeline.md (fact vs opinion classification, routed retrieval, code-decided verdicts)
## [2026-11-21] update | stack-research added; Deno Deploy sunset (Apr 2027) verified and noted in stack-direction; index updated with all pages
## [2026-11-21] update | stack-direction: recommendation for hybrid retrieval in Supabase + cost plan (≤$1-2 per 1,000 checks)
## [2026-11-21] update | added api-endpoints-verified (curl-tested endpoints + flow), multimodal-media, model-selection (EU/ZDR Mistral path, GDPR checklist)
## [2026-11-21] lint | clean: all index links resolve, all pages indexed, routing folders exist
## [2026-11-21] update | verification-pipeline: added claim-splitting philosophy + NBP/TK worked example; gap: nbp.pl press releases not yet a source
## [2026-11-21] update | verification-pipeline: added worked example 2 (opinion piece, Trump/Asia); foreign-politics source gap noted
## [2026-11-21] update | repo: added root .gitignore (env/secrets/keys, Supabase/Deno/Turbo/Node/Python artifacts, local data dumps); .env.example stays tracked per rule 11
## [2026-11-21] decision | 001 private logs schema (user): logs + corpus in a non-exposed schema, RLS with no policies, server-only access
## [2026-11-21] update | added prompts/ (claim extraction, evidence assessment, media extraction + README), product/response-contract.md (language policy: Polish default per the MVP), hackathon/compliance-matrix.md (re-read the PDFs); pipeline: common sense + fair-not-suspicious, refined verdict rules, risk field; routing row for prompts/
## [2026-11-21] update | skill explain-flow added (.agents/skills + Claude shim)
## [2026-11-21] lint | clean: all index and cross-page links resolve (only the format examples in README/index), all pages indexed, prompts/ routed in AGENTS.md
## [2026-11-21] update | hardened the proposed verification workflow with evidence eligibility, failure states, review lifecycle and release checks
## [2026-11-21] update | completed three workflow review rounds: Opus 5.2, 7.2, 8.4 (estimated 9.1 with specified edits); Sol 5.5, 8.5, 9.1; applied final review fixes
## [2026-11-21] lint | checked 32 Markdown pages, routing, index, links and source citations; aligned conflicting workflow guidance
## [2026-11-21] update | Opus round 4 scored 8.9; addressed its remaining gaps in cross-session result reuse, local OCR and reworded report dedupe
## [2026-11-21] lint | checked wiki routing, index, source citations and links; aligned OCR recommendations with local intake
## [2026-11-21] update | merged Fabian's PR #1 (hardened workflow) with local prompts/response-contract work; verification-pipeline keeps his structure plus prompt links, balancing principles, claim type/risk fields, official-statement route and decision 001 link
## [2026-11-21] update | EUvsDisinfo token tested: 401 Invalid API key in every header variant; open question updated
## [2026-11-21] update | open question: claim cap 8 (prompts/claim-extraction) vs 12 (verification-pipeline) after the merge
## [2026-11-21] lint | 3 findings: fixed stale anchor in prompts/evidence-assessment; sufficiency rule and result-state set now differ between prompts/response-contract and the merged pipeline (open-questions)
## [2026-11-21] decision | 002 (user): image OCR back to the vision-model call (no local OCR), PII redaction kept after OCR, no second verifier model; reverted PR #1's local-OCR wording on 6 architecture pages
## [2026-11-21] update | AGENTS.md: .agents/skills and .claude/skills must always hold the same skills; wiki-lint gained a skill-parity check
## [2026-11-21] lint | 1 finding: retention 30 days (decision 001) vs 7 days (pipeline) -> open-questions; links, index, routing and skill parity clean
## [2026-11-21] decision | 003 (user): .env holds only secrets (OpenRouter key, EUvsDisinfo token); models, routing, limits move to code defaults with optional MODEL_* overrides; .env.example trimmed; Google Safety Retention opt-out noted in architecture/model-selection
## [2026-11-21] lint | clean (scoped to decision 003): index, links, skill parity OK; no wiki page references the removed env vars
## [2026-11-21] update | proposed vision transcription for approved public images and code-first checks for typed evidence, with an independent verifier for material prose
## [2026-11-21] lint | checked 39 Markdown pages and aligned intake, model selection and prompt guidance
## [2026-11-21] update | merged Fabian's PR #2: kept decision 002 where it conflicted (all images via the vision model, no second verifier); adopted code-only comparison of typed authoritative records, independence = distinct evidence origins, per-stage cost reporting; open question for Fabian
## [2026-11-21] update | EUvsDisinfo token retested with the current .env value: still 401 Invalid API key; open question updated
## [2026-11-21] update | architecture/euvsdisinfo-mcp: added how to request MCP access directly from EUvsDisinfo (user tip, about page)
## [2026-11-21] update | EUvsDisinfo token retested again after a .env save (14:34): still 401 Invalid API key
## [2026-11-21] update | EUvsDisinfo: the server lists ?key=, Authorization and X-API-Key as accepted; our token gets "Invalid API key" on all three, so the token is the problem, not the request; noted in architecture/euvsdisinfo-mcp
## [2026-11-21] lint | clean after the PR #2 merge: no conflict markers, no verifier or public-only image wording outside decision 002/log, links and skill parity OK
## [2026-11-21] update | skill explain-flow: asks for the output format first (md, PDF with visuals, or both); PDF via assets/template.html + scripts/render-pdf.mjs (headless Chrome/Edge), md stays the source of truth; added input edge cases and a self-check
## [2026-11-21] update | explain-flow on a US-EU/Ukraine analysis text: prompts/claim-extraction gained 4 edge cases (unnamed collective speaker, speech vs feeling, presupposed premise, Western-disunity analysis is not `narrative`); open question on presuppositions
## [2026-11-21] lint | clean (scoped to claim-extraction edge cases + open question): routing, index, sources cited, skill parity OK
## [2026-11-21] decision | 004 first build stack (Astro web, Deno+Hono API, runtime-agnostic core, mock DB) and 005 Supabase schemas→generated migrations workflow
## [2026-11-21] update | first code: architecture/codebase.md added; model-selection (mistral/eu pinning verified, assessment default → mistral-large), prompt pages synced with code v1, pipeline §5 interim choices, response-contract second channel = messaging bot, stack-direction, open questions (Google key name, Bun/Node for Astro 7)
## [2026-11-21] lint | 5 findings fixed: evidence-assessment model + per-claim call (decision 002), prompt path, injection_events -> check_events, Discord adapter -> messaging bot; routing, index, links, skill parity OK
## [2026-11-21] decision | 006 API contract v1 frozen under /api/v1, mock mode with synthetic fixtures; architecture/api-reference.md added; response-contract JSON shape updated to the exact v1 shape; Google key question answered (configured, route verified live); API deployed on Deno Deploy (app dir apps/api, entrypoint main.ts)
## [2026-11-21] lint | 4 findings fixed: unversioned /api/* routes in README, api-endpoints-verified, compliance-matrix, decision 004 -> /api/v1; codebase next steps updated; stack-research left as historical research; routing, index, skill parity OK
