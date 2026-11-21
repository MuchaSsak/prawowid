# Prawdowid

Free fact-checking for citizens: paste a statement, a link or a screenshot, and get each factual claim checked against real sources, with verbatim quotes and links. A prototype for the MSZ task at HackNation 2026.

## Run it locally

Requirements: [Deno](https://deno.com) 2.x and [Bun](https://bun.sh) 1.3+.

```bash
cp .env.example .env        # fill in OPENROUTER_API_KEY and GOOGLE_FACT_CHECK_API_KEY
bun install
bun run api:dev             # API on http://localhost:8787
bun run web:dev             # web app on http://localhost:4321 (second terminal)
```
Or both at once: `bun run dev`. Check the setup: `curl http://localhost:8787/api/v1/health`.

## Tests and benchmark
- `bun run test`: 100 deterministic tests (model and source APIs stubbed, **no credits used**): the verification rules for scenarios A-J, the v1 contract, every API route.
- `bun run eval:quick`: 6 live cases (~$0.005). `bun run eval`: the full 37-case reference set (~$0.04) with the task's metrics (macro-F1, citation coverage, abstention, robustness, latency, cost per 100, end-to-end, channel consistency). `bun run eval:remote`: the same against the deployed API.
- Results: `eval/results/latest.md`; method and known gaps: `.agents/project-info/evaluation/benchmark.md`.

## Structure
| Path | What |
|---|---|
| `packages/core` | the verification core, runtime-agnostic TypeScript: intake, PII masking, claim extraction, evidence routes, quote check, verdict rules |
| `apps/api` | Deno + Hono HTTP API, a thin adapter over the core |
| `apps/web` | Astro web app |
| `supabase` | database workflow for later (`schemas/` → generated migrations), see its README |
| `.agents/project-info` | the project wiki (design, decisions, prompts) |

## API
`POST /api/v1/check` with `{ "input": { "type": "text" | "url" | "image", "value": "…" }, "user_message"?: "…", "session_id"?: "…" }`. `image` takes a `data:` URL (JPG/PNG/WebP, max 5 MB). Every endpoint, header, env var and mock scenario: `.agents/project-info/architecture/api-reference.md`. The response shape: `.agents/project-info/product/response-contract.md`. Machine-readable: `GET /api/v1/schema`.

**Mock mode** (no keys needed): send `"mock": true` or a scenario name, start a text with `demo:<scenario>`, or run the server with `PRAWDOWID_MODE=mock`. Scenarios: `GET /api/v1/mock/scenarios`.

`GET /api/v1/health` shows which keys are configured (yes/no only). `DELETE /api/v1/session/:id` deletes a session's logs.

## How a verdict is made
The LLM only reads and labels. Code decides. Every quote must appear verbatim in the stored source, and citations are built from the source records, never written by the model. Missing keys, outages and limits are shown as system states, never as verdicts. Details: `.agents/project-info/architecture/verification-pipeline.md`.

Current evidence routes: Google Fact Check (ClaimReview) and Sejm ELI (legal acts). GUS, NBP, Eurostat, Sejm votings and our own corpus are next.
