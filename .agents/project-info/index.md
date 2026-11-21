# Wiki index

A catalog of every page and source. Update it whenever a page or source is added, renamed or removed.
Format: `- [path](path): one-line summary`

## Core
- [README.md](README.md): wiki conventions (page format, ingest, decide, lint)
- [open-questions.md](open-questions.md): unresolved questions and unknowns
- [log.md](log.md): history of wiki changes

## rules/
- [rules/README.md](rules/README.md): scope of the folder 
- [rules/hard-constraints.md](rules/hard-constraints.md): 20 non-negotiable rules from the task (no fabricated sources, verdicts vs system states, security, eval integrity)

## hackathon/
- [hackathon/README.md](hackathon/README.md): scope of the folder 
- [hackathon/task-brief.md](hackathon/task-brief.md): full PRAWDOWID brief: MVP, bonus features, technical requirements, pilot path
- [hackathon/judging-and-metrics.md](hackathon/judging-and-metrics.md): criteria weights, gate condition, mandatory metrics, scenarios A-J
- [hackathon/deliverables.md](hackathon/deliverables.md): submission checklist
- [hackathon/regulamin.md](hackathon/regulamin.md): prize 30k PLN, jury rules, copyright transfer to MSZ
- [hackathon/resources.md](hackathon/resources.md): organizer resources, the Discord source list, mentors
- [hackathon/event-and-jury.md](hackathon/event-and-jury.md): HackNation timeline and deadlines (draft Sat 20:00, final Sun 11:00), two-stage judging, past editions, mentors

## problem/
- [problem/README.md](problem/README.md): scope of the folder 
- [problem/overview.md](problem/overview.md): the FIMI and verification problem as MSZ frames it

## audience/
- [audience/README.md](audience/README.md): scope of the folder 
- [audience/overview.md](audience/overview.md): citizen (primary), moderator/analyst, MSZ as stakeholder

## product/
- [product/README.md](product/README.md): scope of the folder 

## architecture/
- [architecture/README.md](architecture/README.md): scope of the folder 
- [architecture/api-endpoints-verified.md](architecture/api-endpoints-verified.md): **every source endpoint tested by curl**, plus the POST /api/check flow and ingestion jobs
- [architecture/model-selection.md](architecture/model-selection.md): OpenRouter models per step, prices, EU/ZDR endpoints, GDPR checklist
- [architecture/multimodal-media.md](architecture/multimodal-media.md): images, YouTube and MP4 video, audio → text (OpenRouter Responses API, Gemini), limits
- [architecture/verification-pipeline.md](architecture/verification-pipeline.md): workflow graph, claim extraction, evidence eligibility, verdict rules, failure states and release checks (Idea)
- [architecture/stack-direction.md](architecture/stack-direction.md): what the team said about the stack (Turborepo, Deno Deploy, OpenRouter, Supabase?)
- [architecture/stack-research.md](architecture/stack-research.md): Deno Deploy (sunset Apr 2027), OpenRouter, Supabase, input handling, Discord, POST /api/check flow
- [architecture/data-sources-research.md](architecture/data-sources-research.md): every source: access, license, priority, corpus plan; live official APIs
- [architecture/euvsdisinfo-mcp.md](architecture/euvsdisinfo-mcp.md): EUvsDisinfo MCP how-to and data shape
- [architecture/technical-approach-research.md](architecture/technical-approach-research.md): pipeline best practice, models, retrieval, injection defense, eval harness, IFCN/EFCSN

## team/
- [team/README.md](team/README.md): scope of the folder 

## decisions/
- [decisions/README.md](decisions/README.md): scope and format of decision records 

## pitch/
- [pitch/README.md](pitch/README.md): scope of the folder 
- [pitch/jury-insights.md](pitch/jury-insights.md): what the jury and MSZ care about, plus a 5-min pitch script

## sources/
- [sources/README.md](sources/README.md): raw source files 
- [sources/2026-11-21-msz-pelna-tresc-zadania.pdf](sources/2026-11-21-msz-pelna-tresc-zadania.pdf): full task text (MSZ)
- [sources/2026-11-21-msz-regulamin-zadania.pdf](sources/2026-11-21-msz-regulamin-zadania.pdf): task regulamin
- [sources/2026-11-21-euvsdisinfo-mcp-how-to.pdf](sources/2026-11-21-euvsdisinfo-mcp-how-to.pdf): EUvsDisinfo MCP how-to
