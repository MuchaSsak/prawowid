# API reference (contract v1)
Every endpoint, header, request field, environment variable and mock scenario of the Prawdowid API, for anyone building a channel (web, messaging bot). The response object itself is owned by [product/response-contract.md](../product/response-contract.md). The contract is frozen ([decision 006](../decisions/006-api-contract-v1-and-mock.md)): mock and live return the same structures, and the real backend (RAG, Supabase) will not change them. Code: `apps/api/main.ts`, `packages/core/src/contract.ts`.

## Base URL
- Local: `http://localhost:8787` (`bun run api:dev`).
- Deployed: **https://prawowid.mateusz.deno.net** (Deno Deploy app `prawowid`, builds from GitHub `main`). Verified 2026-11-21: `/`, `/api/v1/health`, `/api/v1/schema`, `/api/v1/mock/scenarios` and mock checks work; live checks need the env vars below set in the app settings.

## Endpoints
| Method + path | Purpose | Response |
|---|---|---|
| `GET /` | service info | `{ service, contract_version, mode, docs }` |
| `GET /api/v1/health` | is it configured? | `{ ok, contract_version, mode: "live"\|"mock", configured: { openrouter, google_fact_check } (booleans only), models, storage }`; with a valid `X-Client-Key` also `client_mode` (that client's effective mode, see `MOCK_CLIENTS`) |
| `POST /api/v1/check` | run a check | `CheckResponse` ([shape](../product/response-contract.md#json-shape-contract-v1-post-apiv1check--200)) |
| `GET /api/v1/schema` | JSON Schema of request and response | `{ contract_version, request, response }` |
| `GET /api/v1/sources` | the trusted-source allowlist (only these publishers can be evidence) and the statistics we look up; added 2026-11-21, additive to v1 | `{ contract_version, policy, sources: [{ id, name, domains[], kind, tier, country, credentials, access, access_note, terms }], statistics: [{ key, label, unit, definition, sources[] }] }` |
| `GET /api/v1/mock/scenarios` | mock scenario list | `{ how_to_pick[], scenarios: { name: description } }` |
| `DELETE /api/v1/session/:id` | delete a session's logs and cached results | `{ deleted: true, checks: n }` |

Unknown paths: `404 { error, see }`.

## `POST /api/v1/check`
Request body (JSON, max 8 MB):
```jsonc
{
  "input": { "type": "text" | "url" | "image" | "video" | "audio", "value": "…" },  // required
  "user_message": "what the user wants checked (with url/image)",  // optional, ≤ 2000 chars
  "session_id": "opaque id",   // optional: stored only as a SHA-256 hash; DELETE /session/:id removes its data
  "channel": "web" | "api" | "messaging",   // optional; defaults to "messaging" for keyed clients, else "web"
  "mock": true | "<scenario>"  // optional: return mock data (see below)
}
```
A bot can forward a chat message as `text` even when it contains a link: the server also reads the first link in the text (same guards as `url`). If the page cannot be read, the answer carries a `partial_analysis` warning and the text is still checked.
- `text`: up to 50,000 chars (the first 12,000 are analysed, with a `partial_analysis` warning).
- `url`: a public http(s) article. Tracking params are stripped; private-looking params, IP addresses, local hosts and robots.txt-disallowed pages are refused (`input_rejected`).
- `image`: a `data:image/(jpeg|png|webp);base64,…` URL, max 5 MB. Metadata is stripped before the vision call; the image is not stored.
- `video`: a `data:video/(mp4|webm|quicktime|mpeg);base64,…` URL, max 5 MB. `audio`: a `data:audio/…;base64,…` URL (mp3, wav, m4a/mp4, aac, ogg, webm), max 5 MB. Added 2026-11-21 ([decision 009](../decisions/009-video-audio-input-and-web-composer.md)). **Mock only for now:** in live mode a valid recording returns `input_rejected` ("not available yet"), never a verdict. Format and size are checked the same way in mock and live (`packages/core/src/intake/media.ts`), so a channel built on mock gets the same rejections later. The 5 MB cap keeps the base64 body under the 8 MB limit.
- With a file, put what the user typed in `user_message`.

HTTP status codes: `200` for every outcome the pipeline produces, including system states (read `status`, not the HTTP code). `400` = body is not JSON or has no `input` (`status: input_rejected`). `413` = body over 8 MB. `429` = rate limited (`status: rate_limited`).

Live latency: 5-10 s for text (two LLM steps + source APIs), +2 s for an image. Show progress; set the client timeout to at least 35 s (the server's own deadline is 30 s).

## Headers for server-side clients (the messaging bot)
| Header | Meaning |
|---|---|
| `X-Client-Key` | a key from the server's `CLIENT_KEYS`; marks the caller as a trusted server client |
| `X-End-User` | a stable id of the chat user (e.g. the phone number); the server only uses its SHA-256 for rate limiting |

Rate limit: 12 checks per minute per browser IP, or per end user for keyed clients. A bot calling without a key shares one IP-level limit for all its users.

## Mock mode
Mock responses use exactly the live structures, cost nothing, need no keys and take `MOCK_DELAY_MS` (default 600 ms). They are always marked: `meta.mode: "mock"`, `warnings[0].type: "demo_data"`, claims about the fictional town "Przykładowo", sources on `https://example.org/prawdowid-demo/…`.

Pick a scenario (first match wins):
1. `"mock": "<scenario>"` in the request;
2. text input starting with `demo:<scenario>` (works from a chat app, e.g. `demo:partial`);
3. `"mock": true` or `PRAWDOWID_MODE=mock`: `url` input → `url`, `image` → `image`, `video` → `video`, `audio` → `audio`, otherwise a stable hash of the text picks one of confirmed, false, misleading, insufficient_evidence, mixed, conflict (same text → same answer).

| Scenario | Returns |
|---|---|
| `confirmed` / `false` / `misleading` / `insufficient_evidence` | 1 claim with that verdict and citations |
| `not_verifiable` | 1 opinion |
| `conflict` | sources contradict → abstain + `sources_conflict` warning |
| `mixed` | 3 claims: confirmed, insufficient evidence, then the opinion (facts first) |
| `assumptions` | 1 claim with an `assumed_scope` and an `assumed_period` warning |
| `partial` | `status: partial`, one claim with `system_state: source_unavailable` |
| `escalation` | high-risk claim without evidence → `escalation.state: recommended` |
| `injection` | `injection_detected` warning + a normal verdict |
| `url` / `image` | `input.url`/`title`/`published_at` or `input.description` filled |
| `video` / `audio` | `input.type` video/audio, `input.description` filled, claims with timestamped `provenance` (`video@00:42`, `audio@00:18`); audio adds a `partial_analysis` warning |
| `needs_clarification`, `out_of_scope`, `not_a_claim`, `input_rejected`, `rate_limited`, `technical_error` | request-level system states, no claims |

## Server environment variables
| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | live mode | LLM gateway |
| `GOOGLE_FACT_CHECK_API_KEY` | live mode | required evidence route; without it claims return `source_unavailable` |
| `PRAWDOWID_MODE` | no | `mock` makes every check a mock (default `live`) |
| `MOCK_DELAY_MS` | no | simulated mock latency (default 600) |
| `CLIENT_KEYS` | no | `name:key,name2:key2` for server clients |
| `MOCK_CLIENTS` | no | comma-separated client names (from `CLIENT_KEYS`) that always get mock answers, even when `PRAWDOWID_MODE` is live; `bot` holds the messaging bot in mock until its spend caps exist ([messaging-bot](messaging-bot.md)) |
| `WEB_ORIGINS` | no | comma-separated browser origins for CORS (default localhost:4321) |
| `MODEL_CLAIM_EXTRACTION`, `MODEL_EVIDENCE_ASSESSMENT`, `MODEL_IMAGE_EXTRACTION` | no | model overrides ([decision 003](../decisions/003-config-in-code.md)) |
| `PORT` | no | local port (default 8787) |

## Deno Deploy setup
App directory `apps/api`, entrypoint `main.ts`, working directory empty, no build command. Deploys build from GitHub `main`, so unpushed commits are not deployed. Set the env vars above in the app settings, and pick the EU region if offered. Storage is in memory per instance, so logs and the 5-min cache reset on redeploy or cold start until Supabase lands.

## Versioning rules
- v1 changes are **additive only**: a new optional request field, a new response field, a new enum value. Clients must ignore unknown fields and treat an unknown `status`/`system_state`/warning `type` as a generic system message.
- Breaking changes (removing or renaming a field, changing a type) need `/api/v2` and `contract_version: "2.0"`.
- `packages/core/test/contract_test.ts` validates every mock scenario and live outputs against the same schema, so mock and live cannot drift.
