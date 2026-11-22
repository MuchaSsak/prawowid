# API reference (contract v1)
Every endpoint, header, request field, environment variable and mock scenario of the Prawdomat API, for anyone building a channel (web, messaging bot). The response object itself is owned by [product/response-contract.md](../product/response-contract.md). The contract is frozen ([decision 006](../decisions/006-api-contract-v1-and-mock.md)): mock and live return the same structures, and the real backend (RAG, Supabase) will not change them. Code: `apps/api/main.ts`, `packages/core/src/contract.ts`.

## Base URL
- Local: `http://localhost:8787` (`bun run api:dev`).
- Deployed: **https://prawowid.mateusz.deno.net** (Deno Deploy app `prawowid`, builds from GitHub `main`). Verified 2026-11-21: `/`, `/api/v1/health`, `/api/v1/schema`, `/api/v1/mock/scenarios` and mock checks work; live checks need the env vars below set in the app settings.

## Endpoints
| Method + path | Purpose | Response |
|---|---|---|
| `GET /` | service info | `{ service, contract_version, mode, docs }` |
| `GET /api/v1/health` | is it configured? | `{ ok, contract_version, mode: "live"\|"mock", configured: { openrouter, google_fact_check } (booleans only), models, storage, corpus: { state, records }, source_controls: "kv"\|"memory" }`; with a valid `X-Client-Key` also `client_mode` (that client's effective mode, see `MOCK_CLIENTS`) |
| `POST /api/v1/check` | run a check | `CheckResponse` ([shape](../product/response-contract.md#json-shape-contract-v1-post-apiv1check--200)) |
| `GET /api/v1/schema` | JSON Schema of request and response | `{ contract_version, request, response }` |
| `GET /api/v1/sources` | the trusted-source allowlist (only these publishers can be evidence) and the statistics we look up; added 2026-11-21, additive to v1 | `{ contract_version, policy, sources: [{ id, name, domains[], kind, tier, country, credentials, access, access_note, terms }], statistics: [{ key, label, unit, definition, sources[] }], routes: [{ id, label, required }], context_routes: [{ id, label, catalog }] }`; `routes`/`context_routes` added 2026-11-21 (additive): the evidence and context routes this deployment runs ([extensibility](extensibility.md)) |
| `GET /api/v1/mock/scenarios` | mock scenario list | `{ how_to_pick[], scenarios: { name: description } }` |
| `DELETE /api/v1/session/:id` | delete a session's logs and cached results | `{ deleted: true, checks: n }` |
| `GET /api/v1/admin/checks?limit=50` | the check log for the team (MVP "zapis przebiegu"): masked question, time, channel, status, verdicts and cited source ids; needs `Authorization: Bearer <ADMIN_TOKEN>` (401 otherwise), 404 when `ADMIN_TOKEN` is not set; browser-callable only from `WEB_ORIGINS` (CORS allows `Authorization` for the admin page, [decision 011](../decisions/011-admin-analytics.md)). Deno KV (every instance) when the runtime has it, else this instance's memory; added 2026-11-21, additive to v1 | `{ note, checks: CheckLogRow[] }`, newest first |
| `GET /api/v1/admin/analytics?range=24h\|7d\|30d\|90d\|1y` | aggregates for the admin page ([decision 011](../decisions/011-admin-analytics.md)): stat tiles with the previous period (incl. `false_share`, 0..1, since 2026-11-21), volume buckets (hour/day/week/month, Europe/Warsaw, edge buckets `partial`), weekday × hour heatmap, topics (claim type) with growth, a 12-slice spark and verdict counts, the masked text of claims asked ≥2× (with `prev`, `growth` and a 12-slice `spark` since 2026-11-21), integrity counts, channels (a messaging check counts under its `platform` when the bot sent one, since 2026-11-22), and `persistence` (`kv` or `memory`: where the check log lives). Same token rules as above, 400 on an unknown range; added 2026-11-21, additive | `AnalyticsReport` (`packages/core/src/analytics/build.ts`) |
| `GET /api/v1/admin/sources` | every switchable evidence source ([decision 013](../decisions/013-source-controls.md)): live routes, corpus collections, allowlist publishers, each with `enabled`; same token rules; added 2026-11-22, additive | `{ persistence: "kv"\|"memory", revision, updated_at, sources: [{ key, kind: "route"\|"corpus"\|"publisher", id, label, enabled, required?, records?, latest?, tier?, access? }], audit: [{ at, key, enabled }] }` |
| `POST /api/v1/admin/sources` | switch one source: body `{ "key": "corpus:demagog", "enabled": false }`; takes effect on the next check, no deploy; 400 on an unknown key or a bad body | same shape as the GET |
| `GET /api/v1/admin/sources/search?q=` | what the enabled corpus finds for a phrase (no LLM, max 10 hits); empty while `route:corpus` is off | `{ ms, hits: [{ title, publisher, url, published_at, collection, excerpt }] }` |

Unknown paths: `404 { error, see }`.

## `POST /api/v1/check`
Request body (JSON, max 8 MB):
```jsonc
{
  "input": { "type": "text" | "url" | "image" | "video" | "audio", "value": "…" },  // required
  "user_message": "what the user wants checked (with url/image)",  // optional, ≤ 2000 chars
  "session_id": "opaque id",   // optional: stored only as a SHA-256 hash; DELETE /session/:id removes its data
  "channel": "web" | "api" | "messaging",   // optional; defaults to "messaging" for keyed clients, else "web"
  "platform": "discord" | "messenger" | "whatsapp",  // optional, messaging only: the chat app, for the admin channel split (added 2026-11-22, additive); unknown values are ignored
  "mock": true | "<scenario>"  // optional: return mock data (see below)
}
```
A bot can forward a chat message as `text` even when it contains a link: the server also reads the first link in the text (same guards as `url`). If the page cannot be read, the answer carries a `partial_analysis` warning and the text is still checked.
- `text`: up to 50,000 chars (the first 12,000 are analysed, with a `partial_analysis` warning).
- `url`: a public http(s) article. Tracking params are stripped; private-looking params, IP addresses, local hosts and robots.txt-disallowed pages are refused (`input_rejected`).
- `image`: a `data:image/(jpeg|png|webp);base64,…` URL, max 5 MB. Metadata is stripped before the vision call; the image is not stored.
- `video`: a `data:video/(mp4|webm|quicktime|mpeg);base64,…` URL, max 5 MB. `audio`: a `data:audio/…;base64,…` URL (mp3, wav, m4a/mp4, aac, ogg, webm), max 5 MB. Added 2026-11-21 ([decision 009](../decisions/009-video-audio-input-and-web-composer.md)). Live mode transcribes them (Voxtral EU for mp3/wav/ogg audio, Gemini for other audio and all video) and claims carry `provenance` like `audio@00:18`; routing and limits in [multimodal-media](multimodal-media.md#status-2026-11-21-uploaded-recordings-work-live). Format and size are checked the same way in mock and live (`packages/core/src/intake/media.ts`), so a channel built on mock gets the same rejections later. The 5 MB cap keeps the base64 body under the 8 MB limit.
- With a file, put what the user typed in `user_message`.

HTTP status codes: `200` for every outcome the pipeline produces, including system states (read `status`, not the HTTP code). `400` = body is not JSON or has no `input` (`status: input_rejected`). `413` = body over 8 MB. `429` = rate limited (`status: rate_limited`).

Live latency: 5-10 s for text (two LLM steps + source APIs), +2 s for an image. Show progress; set the client timeout to at least 35 s (the server's own deadline is 30 s).

## Headers for server-side clients (the messaging bot)
| Header | Meaning |
|---|---|
| `X-Client-Key` | a key from the server's `CLIENT_KEYS`; marks the caller as a trusted server client |
| `X-End-User` | a stable id of the chat user (e.g. the phone number); the server only uses its SHA-256 for rate limiting |

Rate limits (`apps/api/rate-limit.ts`, in memory per instance, added 2026-11-21). Aim: people and testers practically never hit them, scripts get stopped and shut out. Every refusal is `429` + `Retry-After` (seconds) + `status: rate_limited` with "Spróbuj ponownie za …" in `system_message`.

| Limit | Key | Counts | Value |
|---|---|---|---|
| Burst | browser IP (IPv6 by /64), or end user of a keyed client | every `POST /check`, mock too | 12 at once, then 1 more every 5 s (12/min sustained) |
| Hour / day | same | same | 150 / hour, 600 / day (generous for a shared venue NAT) |
| Abuse ban | same | requests refused by the two limits above | 30 refusals in 10 min → banned 15 min, each repeat ban doubles, max 24 h; requests during a ban don't extend it |
| Service budget | the whole instance | live checks only (they cost money) | 600 / hour, 4,000 / day |
| Per client | `X-Client-Key` client name | live checks only | 1,500 / day |
| Admin login | IP | wrong `ADMIN_TOKEN` | 10 per 15 min → `429` even with the right token; 20 more → 1 h ban |

The IP is the socket address (`remoteAddr`); `X-Forwarded-For` is ignored when one exists, because a caller can write anything into it. If the API is ever put behind a proxy, this needs a trusted-proxy setting. A bot calling without a key shares one IP-level limit for all its users.

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
| `EUVSDISINFO_TOKEN` | no | EUvsDisinfo known-incident context (`context_matches`); without it that route is `skipped` and nothing else changes |
| `PRAWDOWID_MODE` | no | `mock` makes every check a mock (default `live`) |
| `MOCK_DELAY_MS` | no | simulated mock latency (default 600) |
| `ADMIN_TOKEN` | no (secret) | enables `GET /api/v1/admin/checks`, `GET /api/v1/admin/analytics` and the `/api/v1/admin/sources` routes (the admin pages ask for it). Independently of it, every live check writes one JSON audit line to the host log (`event: "prawdowid.check"`: time, channel, status, verdicts, source ids, a hash and the length of the masked question, never its text, so sessions stay deletable) |
| `CLIENT_KEYS` | no | `name:key,name2:key2` for server clients |
| `MOCK_CLIENTS` | no | comma-separated client names (from `CLIENT_KEYS`) that always get mock answers, even when `PRAWDOWID_MODE` is live; `bot` holds the messaging bot in mock until the bot itself is ready for live (its daily quota, M1b); the API spend caps exist since 2026-11-21 ([messaging-bot](messaging-bot.md)) |
| `WEB_ORIGINS` | no | comma-separated browser origins for CORS (default localhost:4321) |
| `MODEL_CLAIM_EXTRACTION`, `MODEL_EVIDENCE_ASSESSMENT`, `MODEL_IMAGE_EXTRACTION` | no | model overrides ([decision 003](../decisions/003-config-in-code.md)) |
| `PORT` | no | local port (default 8787) |

## Deno Deploy setup
App directory `apps/api`, entrypoint `main.ts`, working directory empty, no build command. Deploys build from GitHub `main`, so unpushed commits are not deployed. Set the env vars above in the app settings, and pick the EU region if offered. Storage is in memory per instance, so logs and the 5-min cache reset on redeploy or cold start until Supabase lands.

## Versioning rules
- v1 changes are **additive only**: a new optional request field, a new response field, a new enum value. Clients must ignore unknown fields and treat an unknown `status`/`system_state`/warning `type` as a generic system message.
- Breaking changes (removing or renaming a field, changing a type) need `/api/v2` and `contract_version: "2.0"`.
- `packages/core/test/contract_test.ts` validates every mock scenario and live outputs against the same schema, so mock and live cannot drift.
