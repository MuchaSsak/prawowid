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
