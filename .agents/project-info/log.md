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
- 2026-11-21 | verification-pipeline: added claim-splitting philosophy + NBP/TK worked example; gap: nbp.pl press releases not yet a source
- 2026-11-21 | verification-pipeline: added worked example 2 (opinion piece, Trump/Asia); foreign-politics source gap noted
- 2026-11-21 | repo: added root .gitignore (env/secrets/keys, Supabase/Deno/Turbo/Node/Python artifacts, local data dumps); .env.example stays tracked per rule 11

## [2026-11-21] update | hardened the proposed verification workflow with evidence eligibility, failure states, review lifecycle and release checks
## [2026-11-21] update | completed three workflow review rounds: Opus 5.2, 7.2, 8.4 (estimated 9.1 with specified edits); Sol 5.5, 8.5, 9.1; applied final review fixes
## [2026-11-21] lint | checked 32 Markdown pages, routing, index, links and source citations; aligned conflicting workflow guidance
## [2026-11-21] update | Opus round 4 scored 8.9; addressed its remaining gaps in cross-session result reuse, local OCR and reworded report dedupe
## [2026-11-21] lint | checked wiki routing, index, source citations and links; aligned OCR recommendations with local intake
