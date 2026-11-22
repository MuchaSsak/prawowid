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
## [2026-11-21] update | deployed API URL https://prawowid.mateusz.deno.net recorded in api-reference; all v1 endpoints and mock verified live; env vars not yet set on Deploy
## [2026-11-21] restructure | new folder evaluation/ (routing row in AGENTS.md, index): benchmark.md with the test layers, reference set, metric definitions, two live runs (macro-F1 0.44 -> 0.66) and known gaps; compliance-matrix eval row, open question on human labels, prompt pages synced with the eval-round-1 rules
## [2026-11-21] lint | clean: routing row for evaluation/, index, links (2 format examples only), skill parity OK; conventions page lists evaluation/
## [2026-11-21] decision | 007 messaging bot on the Vercel Chat SDK (Discord, WhatsApp, Messenger) over the HTTP API, mock by default; architecture/messaging-bot.md added; apps/bot built and tested offline + simulated WhatsApp webhook; codebase, compliance-matrix, decision 004 pointer updated; 2 open questions (bot hosting, platform accounts)
## [2026-11-21] lint | clean: new bot page and decision 007 indexed, all relative links resolve (2 hits are format examples), routing rows cover architecture/ and decisions/, skill parity OK
## [2026-11-21] update | architecture/messaging-bot.md: ASCII diagram replaced with a Mermaid graph (same content)
## [2026-11-21] update | open-questions: bot hosting recommendation recorded (Railway over Cloudflare Workers; reasons), still undecided
## [2026-11-21] update | open-questions: bot hosting recommendation changed to a European host (Scaleway Serverless Containers, min/max scale 1; alt Clever Cloud), still undecided
## [2026-11-21] update | open-questions: Vercel added as a bot hosting option (Hobby limits, Redis, fra1), still undecided
## [2026-11-21] decision | bot hosting decided (user): Vercel Hobby, fra1, Upstash Redis EU, Discord slash commands only + WhatsApp + Messenger; decision 007 and messaging-bot updated (diagram, code layout, verification), hosting open question removed; apps/bot split into src/index.ts (Vercel) + src/local.ts (Bun)
## [2026-11-21] lint | clean: links resolve, index synced for messaging-bot and decision 007 (Vercel hosting), answered hosting question removed, skill parity OK
## [2026-11-21] update | bot prototype code removed (user); messaging-bot rewritten as design only (new architecture-level diagram, components, prototype findings); codebase, compliance-matrix, decision 007, index synced
## [2026-11-21] update | bot design council round 1 (scores 6/6/6): messaging-bot revised (concurrent mode, API decides mode, HMAC pseudonym, output safety, data inventory, always-reply, milestones Discord-first), messaging-bot-runbook.md added, decision 007 updated
## [2026-11-21] update | bot design council round 2 (scores 8/8/7): milestones re-anchored to Sat 23:00+, caps gate before live and public invite, Redis from M1 (quota), sanitize every response string, Art. 13 notice, capped image fetch, options read by name, consistency method, deep health + uptime monitor; runbook rewritten; open question on owners and controller
## [2026-11-21] update | bot design council round 3 (scores 8/8/7): 45 s request deadline + maxDuration 300, one catch-all function, dynamic adapter import, token-protected deep health, live-only caps, invite gate split from live gate, legitimate-interest basis, outcome counters in Redis, payload-free SDK logger, Discord install bot scope with 0 permissions, fresh-run consistency as the metric, shutdown checklist, owners
## [2026-11-21] update | bot design council round 4 (final scores: platform 9, security 8, delivery 8): last fixes applied unscored: privacy notice + /usun-dane in M1 before the invite, quota kept after erasure, MOCK_CLIENTS so web live is independent of the bot gate, WhatsApp to the morning, health token in a header, per-platform Chat instances, A8 = fresh run
## [2026-11-21] lint | clean: links resolve, messaging-bot + runbook indexed, decision 007 synced with MOCK_CLIENTS, skill parity unchanged
## [2026-11-21] ingest | sources/2026-11-21-czy-we-wloszech-strajk-generalny.docx (organizer sample Q&A A-J) → hackathon/organizer-sample-answers.md; changes it drove: links in chat messages are read, screenshot-date limitation, abstention says absence ≠ falsehood, Odyseusz gap in open questions
## [2026-11-21] decision | 008 trusted-source allowlist (renumbered from 007 at merge: the bot decision took 007; AP, Reuters via Google Fact Check; PAP and Sprawdzam To as media tier; publisher = one origin); research of the four sources in data-sources-research, blocked sites in api-endpoints-verified, GET /api/v1/sources in api-reference
## [2026-11-21] update | statistics routes live (Eurostat 13 indicators, NBP rates/gold/reference rate, GUS optional) with the code-side number check (codebase, api-endpoints-verified); prompts v2 synced (claim-extraction: indicator fields + fiction rule; evidence-assessment: data records + rating mapping); benchmark run 3 (macro-F1 0.71, 50 cases) and targeted checks in evaluation/benchmark; 4 open questions
## [2026-11-21] lint | 3 findings fixed: compliance-matrix metrics row (37 cases/0.66 → 50 cases/0.71) and source-list row (catalog now public), response-contract example prompt version @1 → @2; routing, index, sources cited, links (2 format examples only), skill parity OK
## [2026-11-21] lint | merge of PR #3 (messaging bot design): index, log, open-questions kept both sides; trusted-source decision renumbered 007 → 008 and every link updated; links resolve, skill parity OK
## [2026-11-21] decision | scope words resolved from context (else literal), year filled by code from the reference date (pasted text: original searched, else submission date), no questions to the citizen about what the system can settle; organizer directive "facts, not opinions" added as hard constraint 21; claim-extraction draft v2 (not yet in code); new release cases in verification-pipeline; open question on the scope warning type
## [2026-11-21] lint | index hard-constraints count updated; links in the edited pages resolve; code still runs prompt v1 (noted in open-questions)
## [2026-11-21] update | code: claim-extraction v2 in packages/core (time_text/time_direction/assumptions), pipeline/dates.ts (year filled from the reference date: publication, original found verbatim in the corpus, else submission), assumed_scope warning added to contract v1 (additive, user), facts before opinions, mock scenario `assumptions`; tests dates_test.ts + 6 pipeline tests (not yet run with deno); open question on the warning type answered
## [2026-11-21] lint | response-contract, api-reference and claim-extraction pages synced with the code; answered open question removed
## [2026-11-21] update | merge with the statistics work: claim-extraction@3 = @2 (indicator/geo/claimed_value/currency, fiction rule) + scope from context, code-filled years, opinion one-liners; dates.ts now also normalizes dates with a year ("16 listopada 2024" → 2024-11-16) and relative words ("wczoraj", "w zeszłym roku") for the statistics connectors; v2 kept for replay
## [2026-11-21] decision | 009 video/audio (renumbered from 007 at rebase: 007 and 008 were taken on main) inputs in contract v1 (mock only, live rejects) and the single-composer web app; api-reference, response-contract (input.type, provenance), codebase, multimodal-media status updated
## [2026-11-21] lint | 1 finding fixed: deterministic test count 100 -> 107 (index, README); index, links (1 format example only), routing, skill parity OK
## [2026-11-21] update | web app: chat flow (hero input → thread with docked input), america.gov-style redesign, in-browser voice recording, self-hosted fonts; codebase web row and decision 009 updated
## [2026-11-21] update | web app: applied the gpt-6.2-sol design review (focus ring in chat, system states fully dashed and off verdict colors, overflow, 44 px targets, no refocus on touch, one-line desktop headline); removed the API status pill and the "how it works" rows at the user's request; codebase web row updated
## [2026-11-21] update | web answer view redesigned for older readers (merged gpt-6.2-sol + Claude Opus proposals): verdict cards with shaped icons, fixed meaning and advice per verdict, big source buttons, overview list, details behind disclosures; codebase and response-contract updated
## [2026-11-21] update | web answer cards: verdict moved into a flush header strip with a "Pewność" pill; "Przykład" banner and tags removed at the user's request (API mock marking unchanged); codebase updated
## [2026-11-21] lint | rebase onto main: index, log, response-contract and README merged keeping both sides; web/video decision renumbered 007 → 009 and links updated; deterministic test count 123 → 149 (measured after merge)
## [2026-11-21] update | bot M1 implemented in apps/bot (console channel, Discord /sprawdz /pomoc /usun-dane, WhatsApp + Messenger handlers, sanitizer, validator, guaranteed reply, content-free logs; 108 offline tests incl. signed Discord/WhatsApp webhooks); API: MOCK_CLIENTS + client_mode in health; messaging-bot implementation status, runbook env vars, api-reference, codebase, decision 007, compliance-matrix synced
## [2026-11-21] lint | 1 finding fixed: messaging-bot allowed_mentions 'verify in M1' resolved from the adapter source; links (2 format examples only), index, routing, skill parity OK; 1 open question added (bot deploy owner, API env vars)
## [2026-11-21] update | bot tested with a real Discord app (local bot + Cloudflare quick tunnel + local mock API): /sprawdz and /demo answer; /demo dropdown added after user feedback; SDK logger now keeps Discord status/error code (no content); messaging-bot status + runbook command list synced
## [2026-11-21] lint | clean: messaging-bot and runbook edits only, links and index unchanged
## [2026-11-21] update | messaging-bot implementation status synced with the code-review fixes (demo: gate ordering, URL cap, reply budget, numeric-only platform error logging, 121 tests)
## [2026-11-21] lint | clean: one page edited, links unchanged
## [2026-11-21] lint | merge of origin/main (web chat app, video/audio input, PR #4) into the bot branch: codebase (bot row + media + web rows), log and README kept both sides; deterministic test count 149 -> 150 (measured after merge: + MOCK_CLIENTS test)
## [2026-11-21] ingest | EUvsDisinfo MCP API docs + claude.ai connector guide (Fibery, rendered headless): server moved to https://mcp.euvsd.info/mcp, stateless mode, new tools search/narratives, key generated on euvsdisinfo.eu; euvsdisinfo-mcp, api-endpoints-verified, data-sources-research, open question updated; new host health OK, token retest pending (user)
## [2026-11-21] lint | clean (scoped to the EUvsDisinfo ingest): new sources cited and indexed, old-host references updated, skill parity ok
## [2026-11-21] update | EUvsDisinfo token works on the new host mcp.euvsd.info (user test: 200 with case data); open question removed; .env.example comment points to the new host
## [2026-11-21] lint | clean: answered EUvsDisinfo open question removed, endpoint pages agree on the new host and the working token
## [2026-11-21] update | EUvsDisinfo built: packages/core/src/narratives (MCP client, live search matcher, corpus matcher + KnownIncidentStore for the DB), context_matches added to contract v1 (additive), known_narrative warning, web rendering, pull script and live smoke script; euvsdisinfo-mcp (built + upgrade path), codebase, api-reference, response-contract updated
## [2026-11-21] lint | clean: links in the edited pages resolve, EUvsDisinfo no longer listed as uncovered, no stale "not used by the code" claims
## [2026-11-21] update | EUvsDisinfo live smoke (user): search shape {results:[...]} with HTML content (now stripped), 1.5 s per search, 19,873 cases, 2/2 correct matches for a test query; eval:quick after claim-extraction v3: 4/5 labelled correct (E03 known gap), 7.3/8.5 s, $0.089 per 100, EUvsDisinfo no_hits on all 4 claims; benchmark report gained a known-incident section
## [2026-11-21] lint | clean: test counts and case totals synced in benchmark and euvsdisinfo-mcp; new known gap 6 (no narrative case in the reference set)
## [2026-11-21] lint | merge of origin/main (bot M1 PR #5, web chat redesign PR #4) under the uncommitted EUvsDisinfo work: wiki pages kept both sides (bot status from main, EUvsDisinfo lines from the work), context-matches rendering ported into the redesigned web answer cards as a disclosure, deterministic test count 150 -> 156 (measured after merge: 156 core+API, 129 bot, check 4/4)
## [2026-11-21] lint | 1 finding fixed: bot open question no longer says "merge to main" (PR #5 is merged); index, links, sources, routing, skill parity OK
## [2026-11-21] decide | product renamed to Prawdomat (decision 010): code, packages, env vars, UI and wiki topic pages; PRAWDOWID kept only as the MSZ task name; trademark check and deployed env var rename left as open questions
## [2026-11-21] lint | clean: decision 010 links resolve, index and open question added, PRAWDOWID left only in hackathon/ (task name), skill parity OK
## [2026-11-21] update | decision 010 narrowed (user): Prawdomat is the display name only; env vars, packages, cookies, UA, prompts reverted to prawdowid
## [2026-11-21] lint | clean: no PRAWDOMAT_ / @prawdomat identifiers left in the wiki, decision 010, index and open question agree
## [2026-11-21] update | organizer samples → rules (user): leading Tak/Nie (To prawda/To nieprawda for statements) only when unambiguous, from evidence-assessment@3 plain_answer; announced ≠ happened, approximation ≠ conflict, available now ≠ content earlier (prompt v3); "ostatnio"/"niedawno" = last 30 days (dates.ts, parsePeriod reads intervals); new eval set eval/organizer-cases.json (X01-X08 samples + R01-R18 variants from real Google Fact Check items) with style checks in eval/run.ts (--cases, --tag, lead/publisher_any/text_includes/text_excludes/accept/user_message)
## [2026-11-21] lint | organizer-sample-answers, response-contract, verification-pipeline, evidence-assessment (prompt mirrored from code v3), benchmark and codebase synced; links checked
## [2026-11-21] explain-flow | Ukraine-war paragraph: 1 attribution fact (Kyiv appeals), 3 opinions; gap = no Ukrainian/international official sources; new open question on splitting conjunctive claims
## [2026-11-21] update | problem/overview.md: statistics for the submission 'why' section (Digital Poland 2026, NASK 2025, Eurostat 2023 to re-check)
## [2026-11-21] update | pitch/blender-scenes-prompt.md: Blender agent prompt for 4 looping background scenes (user brief; Fern style is our Inference, agent must verify)
## [2026-11-21] lint | clean: new pitch page indexed, no text/link drift
## [2026-11-21] update | web UI declutter: demo switch, helper texts and footer delete button removed; new /prywatnosc page holds the erasure button; compact audio button (codebase.md, decision 009 note, open-questions)
## [2026-11-21] lint | 1 finding: index entry for decision 009 still said web runs on mock -> fixed; skills in parity
## [2026-11-21] update | web: ?test=true sample-data mode (browser-side mock, no API); /prywatnosc reduced to one line by the user; erasure gap logged in open-questions
## [2026-11-21] lint | clean: codebase, open-questions in sync
## [2026-11-21] update | web answers: smaller type, removed rating details / limitations / technical details disclosures and the JSON panel (codebase.md)
## [2026-11-21] lint | clean
## [2026-11-21] update | web answer cards restyled after Mobbin references (status pill, serif sentence headline, compact source rows); no confirm on 'Nowe pytanie' (codebase.md)
## [2026-11-21] lint | clean
## [2026-11-21] update | MVP check (user): compliance-matrix MVP section re-checked against the code (4 items ⚠️: web defaults to mock, bot not deployed, log in memory, no keys on Deno Deploy); check log made durable without question text: LoggingCheckStore audit line per check + GET /api/v1/admin/checks behind ADMIN_TOKEN (api-reference, codebase, .env.example)
## [2026-11-21] lint | compliance-matrix intro no longer says "nothing is built"; other sections still describe the design (noted on the page)
## [2026-11-21] update | PII masking: "zadzwoń"/"dzwońcie" (any form of dzwonić) now count as phone cues; found by the new check-log test, a spaced 3-3-3 count of people is still kept
## [2026-11-21] update | merged origin/main (check log, vector DB package) with web UI work; log conflict resolved by keeping both sides
## [2026-11-21] fix | .env.example restored (6c92038 had replaced it); vector DB vars appended as a section
## [2026-11-21] update | web deployed on Vercel (user); codebase next step 1 lists the Vercel build vars (PUBLIC_API_URL, PUBLIC_SITE_URL) and WEB_ORIGINS on the API
## [2026-11-21] decision | 011 admin panel: one analytics page (/admin/analityka, light only), aggregates via GET /api/v1/admin/analytics, sample switch built in the browser, claim text kept out of the host audit line; codebase, api-reference, index, open-questions updated
## [2026-11-21] lint | clean: decision 011 indexed and linked, routing table and skill parity intact, no stale "not callable from a browser" claims left (the two index/README "dead links" are format examples)
## [2026-11-21] update | web: OGL living backdrop (slow shader in place of the static hero gradient), Seo.astro with Open Graph/Twitter tags + og.png banner (PUBLIC_SITE_URL), mobile fixes from a Playwright pass at 320-1440 px; codebase web row and .env.example updated
## [2026-11-21] lint | clean: web backdrop/OG/mobile entry fits the codebase web row, routing table, index and skill parity intact (the two "dead links" are format examples)
## [2026-11-21] update | web: "Usuń dane sesji" footer button calls DELETE /api/v1/session/:id with a toast; compliance-matrix privacy row now ⚠️ (placeholder /prywatnosc, per-instance memory store)
## [2026-11-21] lint | 2 findings: codebase web row and open-questions still said the web UI had no delete-session button -> fixed
## [2026-11-21] update | web backdrop moved from the hero panel to the dark page background on the input screen (user), hidden in chat; codebase web row updated
## [2026-11-21] lint | clean: one-row edit in codebase.md, no new pages, routing/index/skills unchanged
## [2026-11-21] update | admin: full-screen key lock, "Tematy" = most checked claims with verdict, removed verdict-mix and integrity cards, Ruch last, micro entry animations (decision 011, codebase rows)
## [2026-11-21] lint | 2 findings: index entry and api-reference still described the old admin blocks / top_claims shape -> fixed
## [2026-11-21] update | admin: "Sprawdzone zdania" and cost tiles replaced by one "Fałszywe lub mylące" share tile (new kpis.false_share), heatmap + Ruch in one row, sparkline hover popover (decision 011, codebase, api-reference, index)
## [2026-11-21] lint | clean: admin facts agree across decision 011, codebase, api-reference and index; no new pages, routing and skills unchanged
## [2026-11-21] update | web chat: loading skeleton with a 1-1.5 s minimum (also in sample mode), micro entry animations for bubbles and answer blocks (codebase web row)
## [2026-11-21] lint | clean: one-row edit in codebase.md, no new pages, routing/index/skills unchanged
## [2026-11-21] update | /prywatnosc keeps "Nie robimy tego w 24h bez prawnika!" and adds 5 points a real policy must cover; codebase and compliance-matrix updated
## [2026-11-21] lint | clean: privacy wording consistent across codebase, compliance-matrix and open-questions
## [2026-11-21] update | user: the placeholder /prywatnosc is accepted for the hackathon and not counted in compliance; open question removed, compliance-matrix privacy row reworded
## [2026-11-21] update | added minimal vector DB integration plan: Python retrieval service behind HttpCorpusStore, existing core and API contract unchanged
## [2026-11-21] update | web navbar: "Panel" link to /admin/analityka on the right (codebase web row)
## [2026-11-21] lint | clean: one-row edit in codebase.md, no new pages, routing/index/skills unchanged
## [2026-11-21] update | implemented local vector DB path: pgvector Docker Compose, HttpCorpusStore wiring, health flag, source catalog entry and end-to-end README commands
## [2026-11-21] update | compliance-matrix after two pulls (user): web row = always live (needs deployed API + keys), privacy row ⚠️ (no notice or delete button in the web app), corpus row = Python vector DB with 21 policja.pl articles, not wired into the core, docker-compose.yml missing; archiving row notes the stored full texts
## [2026-11-21] update | bonus "swappable channels, models and sources" (user): runCheck takes deps.connectors / deps.narrativeMatchers (defaults unchanged), plugin types exported from @prawdowid/core, GET /api/v1/sources lists routes and context_routes; new page architecture/extensibility.md (recipes, proving tests, vector-DB wiring example); index, codebase, api-reference, compliance-matrix, README updated; 4 new tests
## [2026-11-21] lint | new page indexed and linked from codebase, api-reference, compliance-matrix and README
## [2026-11-21] update | rebased the extensibility commit onto origin/main (admin analytics, vector DB plan): conflicts in log, compliance-matrix privacy row (kept the newer delete-button text, added the masking detail) and main_test (kept both tests); extensibility.md vector-DB example replaced by a pointer to vector-db-integration-plan (store swap behind the corpus route, no new connector)
## [2026-11-21] update | rebased the extensibility commit onto 2e32f15 (HttpCorpusStore wired): main.ts imports both HttpCorpusStore and NARRATIVE_MATCHERS; compliance-matrix corpus row no longer says the vector DB is unwired or docker-compose is missing; extensibility.md says the store swap is built
## [2026-11-21] update | vector-db-integration-plan: 'Co zostało' gap list after 2e32f15 (localhost-only hosting, 21 docs/1 domain, no collectors, EUvsDisinfo store, adapter tier/timeout, corpus policy, eval)
## [2026-11-21] lint | 1 finding: index summary of vector-db-integration-plan lacked the new gap list -> fixed; routing table and skill parity intact
## [2026-11-21] update | vector-db-integration-plan: corpus content profile (2 policja.pl RSS feeds, mostly PR news); lint clean
## [2026-11-21] update | web backdrop restored to the committed version (hero panel + chat screen) after the user clarified; the page-background variant was dropped
## [2026-11-21] update | web: backdrop on the dark outer edge of the landing page and behind the chat (user clarified), stop button (red square, Escape) that cancels a running check; codebase web row updated
## [2026-11-21] lint | clean: one-row edit in codebase.md, no new pages, routing/index/skills unchanged
## [2026-11-21] update | cost sheet for the deliverable 'cost of 1,000 queries, channel maintenance, behaviour under load' (apps/web/public/dokumenty/prawdomat-koszty-1000-sprawdzen.xlsx; Google Sheets connector not authorized, so upload by hand); /admin/dokumenty page (decision 011); deliverables + compliance-matrix updated; pitch/README links the user's Prawdomat Design System artifact
## [2026-11-21] lint | clean: cost sheet + /admin/dokumenty edits (011, deliverables, compliance-matrix, pitch/README, index); routing, index, links and skill parity intact
## [2026-11-21] update | Prawdomat Design System filled (artifact JoqhxzNKkfsTALddYMMckr): tokens from apps/web, fonts, rosette assets, 14 A4/16:9 components, brand book with brevity limits; new page pitch/design-system.md
## [2026-11-21] lint | clean: new pitch/design-system.md (links resolve, indexed), pitch/README link, routing and skill parity intact
## [2026-11-21] update | user: no uppercase eyebrow labels above titles; removed the "Arkusz" label (and the `kind` field) from /admin/dokumenty; new page rules/ui-conventions.md
## [2026-11-21] lint | clean: new rules/ui-conventions.md (links resolve, indexed, rules/ routed), skill parity unchanged

## [2026-11-21] update | web answers: photo/video-frame backdrop (public-domain samples in ?test=true), favicons on source links, share button (native on touch, clipboard on desktop), meter on the pill row, quote icons, no confirmed advice/stance label, spacing pass; codebase web row updated
## [2026-11-21] lint | clean: one-row edit in codebase.md (web answer extras); routing, index, links and skill parity intact
## [2026-11-21] update | cost sheet now the hosted Google Sheet (card on /admin/dokumenty, local xlsx removed) and cut down to costs, assumptions and 3 load lines at the user's request; deliverables + decision 011 updated
## [2026-11-21] lint | clean: two one-line edits (deliverables, 011); no links or index entries affected
## [2026-11-21] update | Google Sheet rewritten in place through the Sheets connector (tab renamed 'Koszty', same link): 5 cost rows, 5 inputs with sources, 3 load lines; values checked after the write (1,18 USD / 4,78 zł per 1000 text checks)
## [2026-11-21] decide | rules/cost-sheet.md: the user's rule that the cost sheet is always kept current with real (measured or verified) numbers; triggers, sources, cell map
## [2026-11-21] lint | clean: one new rules page, indexed, links resolve, routing unchanged (rules/ already routed)
## [2026-11-21] update | /prywatnosc rewritten in the team's casual voice (lowercase, little punctuation, same five points); codebase web row updated
## [2026-11-21] lint | clean: one phrase in codebase.md, no links or index entries affected
## [2026-11-21] update | web: visible stance labels removed from all source rows (user); codebase web row updated
## [2026-11-21] lint | clean: two phrase edits in codebase.md
## [2026-11-21] update | web: source quotes flush left (no left rule), more space under the verdict pill, globe fallback for links without a favicon
## [2026-11-21] lint | clean: phrase edits in codebase.md only
## [2026-11-21] update | web: source quote text tinted by stance (green / red / orange); lint clean
## [2026-11-21] update | web ?test=true: every sample answer gets a public-domain backdrop photo (4 Highsmith/LoC topic photos added); lint clean
## [2026-11-21] update | bot Vercel deploy: repo owner (MuchaSsak) must link it, tracked in GitHub issue #6; CLI fallback and Hono preset noted in the runbook
## [2026-11-21] update | web app live at https://prawdomat.vercel.app (Vercel project prawdomat); bot deployed as Vercel project prawdomat-bot (https://prawdomat-bot.vercel.app)
## [2026-11-21] update | bot crash on Vercel (ERR_MODULE_NOT_FOUND for .ts specifiers) fixed: relative imports in apps/bot now end in .js; deployment recorded in messaging-bot.md
## [2026-11-21] update | messaging-bot-runbook: Vercel Hobby team blocks PR deployments by non-member Git authors (PR #7 checks); not a code failure
## [2026-11-21] fix | long articles ended in "Nieoczekiwany błąd": an LLM timeout during the response body read escaped as DOMException; openrouter.ts now maps it to LlmError("timeout")
## [2026-11-21] update | square logo apps/web/public/logo-512.jpg (512 × 512, white bg, navy rosette) added; recorded in pitch/design-system.md
## [2026-11-21] lint | clean (scope: logo-512.jpg note in pitch/design-system.md; structural checks on the whole wiki)
## [2026-11-21] update | bot on Vercel crashed on every route: Vercel Hono zero-config used src/app.ts (no default export) as entrypoint; renamed to src/routes.ts; missing BOT_ID_SECRET now reported on /health (503) instead of throwing; / and /favicon.ico added; runbook + messaging-bot updated
## [2026-11-21] lint | 2 findings: messaging-bot status table and test count were stale (fixed); README format-example link is expected
## [2026-11-21] update | live check of a fresh onet.pl article: all-abstain is a coverage gap (no news route, empty corpus), not a DB/OpenRouter bug; suspicious implied_warning noted; evaluation/benchmark.md known gaps 3 and 7
## [2026-11-21] lint | clean (scope: evaluation/benchmark.md known gaps; no new pages or sources, index and routing unchanged)
## [2026-11-21] update | bot live on Vercel: Hono entry must import hono itself (build error fixed in src/index.ts); /health 200 ok, Messenger enabled, Discord vars not set
## [2026-11-21] update | gov.pl ministry news lists are static HTML (MAP Balczun release found), site search is JS-only; added to architecture/data-sources-research.md
## [2026-11-21] lint | clean (scope: one bullet in data-sources-research.md; index and routing unchanged)
## [2026-11-21] update | hero background video: Blender loop converted to WebM (+ poster), plays muted on loop behind the hero text with a dark CSS overlay; architecture/codebase.md (apps/web row), status line in pitch/blender-scenes-prompt.md
## [2026-11-21] lint | clean (scope: codebase.md apps/web row, blender-scenes-prompt status line, index summary; routing and skill parity unchanged)
## [2026-11-21] update | film grain noise over the hero video; architecture/codebase.md (apps/web row)
## [2026-11-21] lint | clean (scope: one clause in codebase.md apps/web row; index and routing unchanged)
## [2026-11-21] update | dev-only slider panel for hero darkness and grain (HeroTuner.astro); architecture/codebase.md (apps/web row)
## [2026-11-21] lint | clean (scope: one clause in codebase.md apps/web row; index and routing unchanged)
## [2026-11-21] update | hero darkness and grain fixed at the user's slider picks (extra 10% navy, grain 50%/400px/0.6s); slider panel removed; architecture/codebase.md
## [2026-11-21] lint | clean (scope: one clause in codebase.md apps/web row; index and routing unchanged)
## [2026-11-21] update | mobile pass on the web app and admin: phone composer as a card with buttons under the text, hints measured to fit one line, admin key lock no longer overflows, /admin/dokumenty gap fixed; architecture/codebase.md
## [2026-11-21] lint | clean (scope: mobile line in architecture/codebase.md; index, routing and skill parity unchanged)
## [2026-11-21] update | themes hard-set: public site always dark, admin always light, OS setting ignored (white landing seen on a light-OS machine); architecture/codebase.md
## [2026-11-21] lint | clean (scope: theme sentence in architecture/codebase.md; index, routing and skill parity unchanged)
## [2026-11-21] update | live video/audio transcription built (intake/recording.ts): Voxtral EU for mp3/wav/ogg, Gemini for other audio and video, web mic re-encoded to WAV; multimodal-media, api-reference, codebase, model-selection, media-extraction prompt, decision 009 note; open question on the OpenRouter key limit for video
## [2026-11-21] lint | clean (scope: recording transcription pages; links, anchors, index, skill parity checked; README format-example link is intentional)
## [2026-11-21] update | API rate limits rebuilt (apps/api/rate-limit.ts): token-bucket burst 12 + 1/5 s, 150/h, 600/day per IP (IPv6 /64) or end user, abuse ban 15 min doubling to 24 h, live-check budget 600/h 4,000/day, 1,500/day per client key, admin login guard, Retry-After; socket IP over spoofable X-Forwarded-For; api-reference, codebase, messaging-bot (spend limits done), deliverables, cost sheet B19-B20
## [2026-11-21] lint | 4 findings fixed: stale 12/min limit in messaging-bot (2x), MOCK_CLIENTS row and open question still waiting on spend caps, cost-sheet trigger now names rate-limit.ts; skill parity ok
## [2026-11-21] update | Discord /demo removed (bot gets live answers; it only replied "demo unavailable"); demo: text gate kept; runbook + messaging-bot updated
## [2026-11-21] lint | 1 finding: bot test count 135 -> 134 after /demo removal (fixed)
## [2026-11-21] lint | 1 finding fixed during PR #11 rebase: clarified which rate limits can return 429 before mode routing. Preserved both log histories and verified routing, index, source citations, links and skill parity.
## [2026-11-21] update | pitch deck built in Google Slides (10 slides, design-system styling, timed speaker notes + Q&A): pitch/deck.md added; card on /admin/dokumenty; deliverables, pitch README, index, open-questions updated
## [2026-11-21] lint | clean: pitch/deck.md indexed and linked, all links resolve (only README/index format examples), routing and skill parity ok
## [2026-11-21] update | web Lighthouse pass with no visual change: architecture/web-performance.md added (scores before/after: home mobile 83 -> 98, admin analytics 0 -> 99, docs CLS 0.17 -> 0; inlined CSS, poster preload, video + grain after load, ogl dropped for plain WebGL in a worker, Newsreader pinned at 400 + Polish font subsets, fallback font metrics, SEO files); codebase web row, ui-conventions (supported widths 320 px to ultrawide, user), index, open question on the cost sheet's sharing
## [2026-11-21] lint | clean (scope: web-performance, codebase web row, ui-conventions, index; links resolve except the intentional index format example; no OGL mentions left outside the log; routing and skill parity unchanged)
## [2026-11-21] update | web: PageSpeed Insights (no GPU, SwiftShader) scored the pre-perf deploy 69 / TBT 38 s; backdrop now reports a GPU verdict and, without a GPU, the hero video and grain stay off (poster as still); PSI-like local run 99-100 / TBT 0; architecture/web-performance.md and index updated
## [2026-11-21] lint | clean (scope: web-performance.md PageSpeed section, index line; links resolve, routing and skill parity unchanged)
## [2026-11-21] update | rebased the extensibility commit onto origin/main (admin analytics, vector DB plan): conflicts in log, compliance-matrix privacy row (kept the newer delete-button text, added the masking detail) and main_test (kept both tests); extensibility.md vector-DB example replaced by a pointer to vector-db-integration-plan (store swap behind the corpus route, no new connector)
## [2026-11-21] update | rebased the extensibility commit onto 2e32f15 (HttpCorpusStore wired): main.ts imports both HttpCorpusStore and NARRATIVE_MATCHERS; compliance-matrix corpus row no longer says the vector DB is unwired or docker-compose is missing; extensibility.md says the store swap is built
## [2026-11-21] decision | 012 source ingestion (user): 12 months back, full texts unless forbidden + short policy, laptop, Python (httpx/selectolax/trafilatura/feedparser), adapters per platform, snapshots for live-state sources, Playwright only as fallback (Odyseusz has a JSON API), PAP only /mediaroom (robots blocks AI crawlers); index and open-questions updated
## [2026-11-21] update | 012: snapshot interval 60 min (15 min for GDDKiA and RSO); Python 3.12 and Docker installed on the user's laptop, so ingest runs there; both 012 open questions removed
## [2026-11-21] update | 012: ingestion moves into PavelSfk/Data (its requests/bs4 conventions win); we work LINKS_STATUS.md bottom-up from Kancelaria Premiera, another person top-down; Google Fact Check last; local only, no push
## [2026-11-21] update | data-sources-research: Demagog recheck (honest UA gets 200, Content-Signal ai-train=no/use=reference, no ai-input signal) and a 3-year volume estimate from its sitemaps (~3,500-4,000 pages)
## [2026-11-21] update | 012: Demagog (3 years) first in our queue; adapter alert_collector/demagog.py in PavelSfk/Data (sitemaps + JSON-LD ClaimReview, clean paragraphs), trial run 15/15 ok, full run of ~3,800 pages started
## [2026-11-21] update | 012: archive range cut to 6 months; Data repo conventions adopted except IMGW, GDDKiA and RSO, which keep our snapshot-history convention
## [2026-11-21] update | 012: Demagog is the exception to the 6-month range and keeps 3 years
## [2026-11-21] update | 012: KPRM collected in PavelSfk/Data (govpl.py adapter for any gov.pl news list, 111 articles / 6 months, future page dates dropped and flagged); Dyplomacja marked as the Odyseusz redirect; teammate already did GDDKiA news/info, RSO, RCB daily report, so we skip them; rule: check origin LINKS_STATUS before each source
## [2026-11-21] update | 012: our part of the list done in PavelSfk/Data (local commits, not pushed): Demagog (downloading), KPRM 111, MSWiA 117, RCB komunikaty 231, IMGW meteo/hydro/Baltic with state history (snapshots.py, snapshot_live.py; RSO history only, data/rso.json stays the teammate's); Wody Polskie belongs to a teammate
## [2026-11-22] ingest | Pavel's architecture proposal -> sources/2026-11-21-pavel-architecture-proposal.txt; review page architecture/pavel-proposal-review.md; conflicts added to open-questions; also: periodic snapshot loop (IMGW, RSO) removed at the user's request
## [2026-11-22] update | 012: snapshot loop removed entirely (IMGW and RSO), unpushed commit rewritten; Demagog done (3545 articles, 16 network failures left out on purpose); IMGW history to come from danepubliczne.imgw.pl/data/arch (monthly zips: meteo warning PDFs ~945 MB / 6 months, hydro warning TXT ~1.6 MB)
## [2026-11-22] update | 012: no meteorological data (user); IMGW Hydro from the ost_hydro archive (1612 warnings, 6 months, 137 coastal for Bałtyk) and 6 PSHM bulletins, committed locally in PavelSfk/Data
## [2026-11-22] update | rebased the wiki commit (012 + Pavel review) onto origin/main: index keeps the team's new layout with the two new entries, open-questions and log keep both sides

## [2026-11-22] update | /admin/analityka: export icon button (dropdown CSV or JSON of the current report, client-side, no API change)

## [2026-11-22] decision | Answers always in Polish (input and sources any language); dropped the answer-in-user-language idea (response-contract.md, codebase.md)
- 2026-11-22: ocena danych z example/ (repo „dane”) pod lokalny korpus BM25; stare wejście pgvector wektorowe zostało usunięte
## [2026-11-22] ingest | Imported the current PavelSfk/Data JSON snapshot into local data/raw and copied collector provenance into tools/collector
## [2026-11-22] lint | 0 structural findings: routing, index paths and skill parity are clean after the Data import
## [2026-11-22] update | removed Python/pgvector corpus integration; added IndexedCorpusStore BM25, alert-data converter, local corpus index, archive policy and corpus-specific eval cases
## [2026-11-22] lint | corpus migration pass
## [2026-11-22] update | decision 013 source controls: BM25 search uses the load-time index (same results, ~2.1 s -> ~30 ms per search), switches for routes/collections/publishers in core + API + /admin/zrodla, corpus rebuilt with all usable raw data (9792 records, 48 353 fragments); codebase, api-reference, 012, 008, open-questions, index updated
## [2026-11-22] lint | 1 finding: codebase.md still called the corpus route an empty mock -> fixed; routing, index, links and skill parity clean
## [2026-11-22] update | retrieve keeps the best record of every route before filling by rank (Eurostat figure was pushed out by corpus fragments); GUS connector falls back to a saved API copy (scripts/snapshot_gus.ts); codebase updated
## [2026-11-22] lint | clean: two codebase rows edited, links and index unaffected
## [2026-11-22] update | corpus build reworked (user): passages instead of sentences, Demagog verdict cards + article opening, publisher names, origin_key per publisher, retrieved_at from raw, validity / snapshot headers; codebase and 012 updated
## [2026-11-22] update | decision 013 edge cases (Fable review): publisher by most specific domain, publisher-only required route -> unavailable, corpus route off hides dates lookup too, disabled optional route keeps strength, 2 s read timeout, /api/v1/sources fails closed, stale keys re-enable
## [2026-11-22] update | kgsok on the allowlist + build-time allowlist check (008), converter strips only real tags (012), per-tier rank fusion and sort-then-filter in BM25 (codebase); corpus 31 970 passages
## [2026-11-22] lint | clean: edits to 008, 012, 013, codebase; links and index unaffected
## [2026-11-22] update | full code review (Fable + Astra) fixes: robots.txt RFC 9309 matching + AI-crawler groups for pasted links (012, user decision), SSRF-safe robots redirects, whole-name private params, fact-check cards by shape (evidence-assessment), Demagog ratings kept in the corpus (3142/3142 cards), key-safe transport errors, partial route failures, cache fixes (codebase)
## [2026-11-22] lint | clean: 012, codebase, evidence-assessment edited; links and index unaffected
## [2026-11-22] update | MVP re-check against the task PDF (user): web + deployed API live with keys, one live check ok (7.3 s); bot /health shows discord + messenger; logs still in memory; gaps unchanged (corpus 100/10, moderator notify, deliverables); hackathon/compliance-matrix.md
## [2026-11-22] lint | clean (scope: MVP rows of hackathon/compliance-matrix.md; anchor #language-policy resolves, index entry unchanged, routing and skill parity untouched)
## [2026-11-22] update | final review of PR #17 (GPT Sol 6/10, Claude Opus 8/10 approve): rating override guarded by polarity + recognised rating (evidence-assessment), DNS resolver for fact-check article fetches, partial failures counted after the allowlist filter, robots group/escape fixes
## [2026-11-22] decision | Proprietary LICENSE (all rights reserved, jury may run it to evaluate, relicensing possible later); decisions/014, index, README
## [2026-11-22] lint | clean: decisions/014 links resolve, index entry added, routing and skill parity untouched
## [2026-11-22] update | Rule: every hosted document (cost Google Sheet, jury deck) stays up to date, same turn as the change, edited in place (user); rules/documents-current.md, linked from rules/cost-sheet.md, index
## [2026-11-22] lint | clean (scope: rules/documents-current.md; links resolve, index entry added, routing and skill parity untouched)
## [2026-11-22] update | Cost sheet audit (user asked if prices are real): sheet matches the full run of commit 636ac78 ($0.177/100, 7.2 s), NBP 4.0613 of 20.11 is the latest table, limits match apps/api/main.ts; deliverables.md synced from stale $1.18 / 6.4 s; eval/results/latest.md is overwritten by a keyless run ($0, 0/50)
## [2026-11-22] lint | clean (scope: hackathon/deliverables.md cost line; matches the sheet, no new links)
## [2026-11-22] update | Fact checker too eager to ask (user report): claim-extraction@6 (named subject + predicate always checkable, open questions only, joined clarification reply), case-insensitive claim spans, evidence-assessment@6 (same person ≠ same subject), web joins a reply to the clarified question; eval Q01-Q03; full run 0.71 / 89% / $0.189 per 100 / 8.2 s; cost sheet B12, C12, B18 + deliverables synced; prompts/*, product/response-contract.md, evaluation/benchmark.md, index
## [2026-11-22] lint | 2 findings: architecture/codebase.md and hackathon/compliance-matrix.md named claim-extraction@3 -> fixed to @6; links in changed pages resolve, skill parity untouched
## [2026-11-22] update | deployed the static web app to Vercel project rocketplns-projects/prawdomat, verified HTTP 200 and Deno API CORS, left production env setup to the user
## [2026-11-22] lint | 2 findings fixed: compliance matrix and bot runbook now refer to the current web deployment; routing, index, source citations and skill parity checked
## [2026-11-22] update | Vercel CLI rejected GitHub connection for the frontend; recorded owner access and main-branch build fix requirements in architecture/codebase.md
## [2026-11-22] lint | clean for Git integration update; routing, index, source citations and skill parity checked
## [2026-11-22] update | admin panel: analytics missing on Vercel = trailing slash in PUBLIC_API_URL (now stripped at build, redeployed); lag = Intl.formatToParts per row in buildAnalytics (cached offset, ~3x faster) + sample report cache; architecture/codebase.md
## [2026-11-22] lint | clean for admin speed and API URL update; routing, index, source citations, links and skill parity checked
## [2026-11-22] update | web input hints are statements, not questions; example is the true claim on the 2025 minimum wage (4666 zł); architecture/codebase.md
## [2026-11-22] lint | clean for input hint update; one-line change, links and index unaffected
## [2026-11-22] update | Regression found (user): first v6 run 0.71 vs 0.78 of commit 636ac78; wide assessment rule lost A09/G02; narrowed to fact-checks of another claim about the same person; full run 0.79 (84%), 58/58 e2e, $0.210/100, 8.3 s; cost sheet B12/B18 + deliverables synced; user rule recorded in evaluation/benchmark.md: stay comfortably above targets, compare with the last full run
## [2026-11-22] lint | clean (scope: prompts/evidence-assessment.md, prompts/README.md, evaluation/benchmark.md, deliverables, index; numbers match latest.md and the sheet)
