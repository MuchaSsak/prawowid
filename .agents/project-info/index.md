# Wiki index

A catalog of every page and source. Update it whenever a page or source is added, renamed or removed.
Format: `- [path](path): one-line summary`

## Core
- [README.md](README.md): wiki conventions (page format, ingest, decide, lint)
- [open-questions.md](open-questions.md): unresolved questions and unknowns
- [log.md](log.md): history of wiki changes

## rules/
- [rules/README.md](rules/README.md): scope of the folder 
- [rules/hard-constraints.md](rules/hard-constraints.md): 21 non-negotiable rules from the task and the organizers (no fabricated sources, verdicts vs system states, security, eval integrity, facts not opinions)
- [rules/ui-conventions.md](rules/ui-conventions.md): user's UI style rules (no uppercase eyebrow labels above titles, less text, supported widths 320 px to ultrawide)
- [rules/documents-current.md](rules/documents-current.md): **every hosted document (Google Sheets cost sheet, Slides deck) stays up to date**: same turn as the change, edit in place, real numbers, wiki and document agree, table of documents
- [rules/cost-sheet.md](rules/cost-sheet.md): **keep the cost Google Sheet current with real numbers**: when to update (full eval runs, model/price, hosting/channel, limits, NBP rate), sources per input, keep it small, cell map

## hackathon/
- [hackathon/README.md](hackathon/README.md): scope of the folder 
- [hackathon/task-brief.md](hackathon/task-brief.md): full PRAWDOWID brief: MVP, bonus features, technical requirements, pilot path
- [hackathon/judging-and-metrics.md](hackathon/judging-and-metrics.md): criteria weights, gate condition, mandatory metrics, scenarios A-J
- [hackathon/deliverables.md](hackathon/deliverables.md): submission checklist
- [hackathon/regulamin.md](hackathon/regulamin.md): prize 30k PLN, jury rules, copyright transfer to MSZ
- [hackathon/resources.md](hackathon/resources.md): organizer resources, the Discord source list, mentors
- [hackathon/compliance-matrix.md](hackathon/compliance-matrix.md): **every task requirement vs our design**: covered, risks and gaps (corpus archiving policy, eval set, deliverables)
- [hackathon/organizer-sample-answers.md](hackathon/organizer-sample-answers.md): **organizer sample questions and model answers for A-J** (Demagog via Google index as backbone, abstain with what source is needed, links in chat, screenshot dates, Odyseusz) and what we changed
- [hackathon/event-and-jury.md](hackathon/event-and-jury.md): HackNation timeline and deadlines (draft Sat 20:00, final Sun 11:00), two-stage judging, past editions, mentors

## problem/
- [problem/README.md](problem/README.md): scope of the folder 
- [problem/overview.md](problem/overview.md): the FIMI and verification problem as MSZ frames it

## audience/
- [audience/README.md](audience/README.md): scope of the folder 
- [audience/overview.md](audience/overview.md): citizen (primary), moderator/analyst, MSZ as stakeholder

## product/
- [product/README.md](product/README.md): scope of the folder 
- [product/response-contract.md](product/response-contract.md): verdicts vs system states, warnings, escalation, **language policy**, tone, the exact v1 JSON shape every channel renders

## architecture/
- [architecture/README.md](architecture/README.md): scope of the folder 
- [architecture/api-endpoints-verified.md](architecture/api-endpoints-verified.md): **every source endpoint tested by curl**, plus the POST /api/check flow and ingestion jobs
- [architecture/model-selection.md](architecture/model-selection.md): OpenRouter models per step, prices, EU/ZDR endpoints, GDPR checklist
- [architecture/multimodal-media.md](architecture/multimodal-media.md): images, video and audio → text; uploaded recordings live (Voxtral EU by format, else Gemini), linked videos still a plan; limits
- [architecture/verification-pipeline.md](architecture/verification-pipeline.md): workflow graph, claim extraction, evidence eligibility, verdict rules, failure states and release checks (Idea)
- [architecture/stack-direction.md](architecture/stack-direction.md): what the team said about the stack (Turborepo, Deno Deploy, OpenRouter, Supabase?)
- [architecture/stack-research.md](architecture/stack-research.md): Deno Deploy (sunset Apr 2027), OpenRouter, Supabase, input handling, Discord, POST /api/check flow
- [architecture/data-sources-research.md](architecture/data-sources-research.md): every source: access, license, priority, corpus plan; live official APIs; **trusted-source allowlist** research (AP, Reuters, PAP, Sprawdzam To)
- [architecture/euvsdisinfo-mcp.md](architecture/euvsdisinfo-mcp.md): EUvsDisinfo MCP: host mcp.euvsd.info, auth, stateless mode, tools cases/articles/search/narratives, data shape
- [architecture/messaging-bot.md](architecture/messaging-bot.md): **the bot channel**: Discord + WhatsApp + Messenger on the Vercel Chat SDK: Mermaid diagram, components, message flow, platforms, security and privacy, milestones and cut line, implementation status (M1 code in apps/bot, deployed as Vercel project prawdomat-bot), prototype findings
- [architecture/messaging-bot-runbook.md](architecture/messaging-bot-runbook.md): bot setup checklists per platform, env vars, acceptance tests (A1-A11), demo-day steps, post-event shutdown
- [architecture/api-reference.md](architecture/api-reference.md): **for channel builders**: every endpoint, header, request field, env var (incl. `MOCK_CLIENTS`), mock scenario, Deno Deploy setup, versioning rules
- [architecture/extensibility.md](architecture/extensibility.md): **bonus: swappable channels, models and sources**: the seams (API, MODEL_<STEP>, `deps.connectors`, `deps.narrativeMatchers`), step-by-step recipes, the proving tests, swapping storage behind the route
- [architecture/codebase.md](architecture/codebase.md): **what is built**: web production deployment, code layout, evidence routes (Google Fact Check, ELI, Eurostat, NBP, GUS), the number check, interim verdict choices, measured latency/cost, next steps
- [architecture/web-performance.md](architecture/web-performance.md): Lighthouse scores before/after for every web page, why PageSpeed (no GPU) scored the old deploy 69 and the GPU verdict that fixes it, what changed and why (inlined CSS, poster preload, video/grain after load, WebGL backdrop in a worker, pinned and Polish-subset fonts, CLS/LCP fixes, SEO files), deliberate ceilings, how to re-check
- [architecture/technical-approach-research.md](architecture/technical-approach-research.md): pipeline best practice, models, retrieval, injection defense, eval harness, IFCN/EFCSN
- [architecture/pavel-proposal-review.md](architecture/pavel-proposal-review.md): review of Pavel's architecture draft: what agrees, what to adopt (hybrid FTS + vector retrieval, common document schema), and conflicts with the frozen contract, the tier rule and the no-snapshot decision

## prompts/
- [prompts/README.md](prompts/README.md): how prompts are used in code, patterns and anti-patterns, the change procedure
- [prompts/claim-extraction.md](prompts/claim-extraction.md): LLM call #1: atomic claims, common sense, classes, types, risk; code v6 (no needless clarification, open questions, joined replies, case-insensitive spans)
- [prompts/evidence-assessment.md](prompts/evidence-assessment.md): LLM call #2: stance + verbatim quote, fair-not-suspicious, code-decided verdict; code v6 (same person ≠ same subject)
- [prompts/media-extraction.md](prompts/media-extraction.md): image OCR + description, video/audio transcripts (draft v1)

## team/
- [team/README.md](team/README.md): scope of the folder 

## decisions/
- [decisions/README.md](decisions/README.md): scope and format of decision records 
- [decisions/001-private-logs-schema.md](decisions/001-private-logs-schema.md): logs and the corpus in a non-exposed Postgres schema, no public CRUD, 30-day retention
- [decisions/002-single-llm-pass.md](decisions/002-single-llm-pass.md): images OCR via the vision model (not local), PII redacted after OCR, no second verifier model
- [decisions/004-first-build-stack.md](decisions/004-first-build-stack.md): Bun/Turbo monorepo, Deno + Hono API, runtime-agnostic core, Astro web app, in-memory mock DB; messaging bot as the later second channel
- [decisions/005-supabase-schema-workflow.md](decisions/005-supabase-schema-workflow.md): `supabase/schemas/` is the source of truth, migrations generated by `db diff`, reviewed and pushed; ignored statements go to hand-written migrations
- [decisions/006-api-contract-v1-and-mock.md](decisions/006-api-contract-v1-and-mock.md): `/api/v1` contract frozen (additive only), mock mode with clearly synthetic fixtures, keyed server clients
- [decisions/007-messaging-bot-chat-sdk.md](decisions/007-messaging-bot-chat-sdk.md): one bot service on the Vercel Chat SDK for Discord, WhatsApp and Messenger, calling the HTTP API (mock by default), hosted on Vercel Hobby (fra1) with Discord slash commands only
- [decisions/008-trusted-source-allowlist.md](decisions/008-trusted-source-allowlist.md): evidence only from an allowlist of publishers (`GET /api/v1/sources`), tier by credentials (PAP, Sprawdzam To = media), one publisher = one origin, no bypassing robots/terms
- [decisions/009-video-audio-input-and-web-composer.md](decisions/009-video-audio-input-and-web-composer.md): `video`/`audio` inputs added to contract v1 (data URLs, 5 MB; live transcription since 2026-11-21), one shared media validator, single-composer web app on mock data (demo switch later removed: web is live-only)
- [decisions/011-admin-analytics.md](decisions/011-admin-analytics.md): admin panel: analytics page (3 stat tiles (checks, Discord/Web/Messenger share, median time), most checked claims grouped across wordings, with verdict and trend; check log in Deno KV, heatmap + traffic; full-screen key lock; aggregates only, sample switch, light only, browser token auth); plus `/admin/dokumenty`, cards with iframe previews of our files (cost sheet first)
- [decisions/012-source-ingestion.md](decisions/012-source-ingestion.md): bulk ingestion of the organizer's sources into the team's Data repo (PavelSfk/Data, its conventions): 6 months back (Demagog 3 years), full texts + short archiving policy, robots/terms respected (PAP only /mediaroom), no periodic state recording, no meteorological data, IMGW hydro from the danepubliczne.imgw.pl archive
- [decisions/013-source-controls.md](decisions/013-source-controls.md): operator on/off switches for routes, corpus collections and publishers (`/admin/zrodla`, `ADMIN_TOKEN`, Deno KV or memory, pinned per check); BM25 kept and made ~75x faster; PR #13 registry not merged
- [decisions/014-proprietary-license.md](decisions/014-proprietary-license.md): `LICENSE` is all rights reserved for now (jury may run it to evaluate); open source possible later
- [decisions/003-config-in-code.md](decisions/003-config-in-code.md): `.env` holds only secrets; models, routing and limits are code defaults, models overridable by optional env vars
- [decisions/010-product-name-prawdomat.md](decisions/010-product-name-prawdomat.md): display name is **Prawdomat**; technical identifiers (env vars, packages, cookies, UA) keep `prawdowid`; PRAWDOWID = the MSZ task

## evaluation/
- [evaluation/README.md](evaluation/README.md): scope of the folder
- [evaluation/benchmark.md](evaluation/benchmark.md): **tests and benchmark**: 156 free deterministic tests, 50-case live reference set (A-J + statistics + organizer-style), metric definitions, results (latest 2026-11-22 on prompts v6: macro-F1 0.79, abstention 89%, robustness/consistency 100%, end-to-end 58/58, $0.210 per 100; rule: stay comfortably above targets), known gaps

## pitch/
- [pitch/README.md](pitch/README.md): scope of the folder; link to the Prawdomat Design System artifact for the deck and PDFs 
- [pitch/design-system.md](pitch/design-system.md): the Prawdomat Design System for PDFs and decks: values taken from apps/web, Paper/Navy themes, 14 A4 and 16:9 components, the brevity limits, what is not on it yet (explain-flow template, charts)
- [pitch/jury-insights.md](pitch/jury-insights.md): what the jury and MSZ care about, plus a 5-min pitch script
- [pitch/deck.md](pitch/deck.md): **the jury deck** (Google Slides, 10 slides + timed speaker notes): one message ("Model czyta, kod decyduje"), outline with the source of every number, placeholders to fill, Slides API build notes
- [pitch/blender-scenes-prompt.md](pitch/blender-scenes-prompt.md): agent prompt for the four looping low-poly, Fern-inspired background scenes (armchair, kitchen table, park bench, kiosk); 2.5 s per shot, hard cuts, no text, no render; the rendered loop now plays behind the web hero

## sources/
- [sources/README.md](sources/README.md): raw source files 
- [sources/2026-11-21-msz-pelna-tresc-zadania.pdf](sources/2026-11-21-msz-pelna-tresc-zadania.pdf): full task text (MSZ)
- [sources/2026-11-21-msz-regulamin-zadania.pdf](sources/2026-11-21-msz-regulamin-zadania.pdf): task regulamin
- [sources/2026-11-21-euvsdisinfo-mcp-how-to.pdf](sources/2026-11-21-euvsdisinfo-mcp-how-to.pdf): EUvsDisinfo MCP how-to (July 2025, old host)
- [sources/2026-11-21-euvsdisinfo-mcp-api-docs.txt](sources/2026-11-21-euvsdisinfo-mcp-api-docs.txt): EUvsDisinfo MCP API docs (May 2026, new host mcp.euvsd.info, 4 tools, stateless mode)
- [sources/2026-11-21-euvsdisinfo-mcp-connect-guide.txt](sources/2026-11-21-euvsdisinfo-mcp-connect-guide.txt): EUvsDisinfo claude.ai connector guide (May 2026; key generated on euvsdisinfo.eu)
- [sources/2026-11-21-czy-we-wloszech-strajk-generalny.docx](sources/2026-11-21-czy-we-wloszech-strajk-generalny.docx): organizer sample chatbot questions and answers per scenario A-J (Piotr Sosnowski)
- [sources/2026-11-21-pavel-architecture-proposal.txt](sources/2026-11-21-pavel-architecture-proposal.txt): Pavel's architecture draft (corpus, retrieval, outcomes); reviewed in [architecture/pavel-proposal-review.md](architecture/pavel-proposal-review.md)
