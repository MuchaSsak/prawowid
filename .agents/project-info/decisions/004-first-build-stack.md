# 004: First build: Astro web app, Deno + Hono API, a runtime-agnostic core, a mock database
Date: 2026-11-21 · Status: decided (user)

Context: the user asked to start building real code: the API first, with a simple Astro web app to type input and see the full result. The mobile channel (a WhatsApp-style texting bot) comes later. Vector DB / RAG and Supabase are postponed and built step by step.

Decision:
- **Monorepo:** Bun workspaces + Turbo (`apps/*`, `packages/*`) and a Deno workspace (`apps/api`, `packages/core`).
- **`packages/core`:** the whole verification pipeline in plain TypeScript with web-standard APIs only (fetch, crypto, AbortSignal), so it runs on Deno Deploy, Supabase Edge Functions, Cloudflare Workers or Node (the Deno Deploy sunset in April 2027, see [stack-direction](../architecture/stack-direction.md)). Every channel calls the same `runCheck` (hard constraint 18).
- **`apps/api`:** Deno + Hono, a thin adapter (`POST /api/check`, `GET /api/health`, `DELETE /api/session/:id`; versioned under `/api/v1` by [decision 006](006-api-contract-v1-and-mock.md)).
- **`apps/web`:** Astro 7, a static page that calls the API. Astro 7 needs Node ≥ 22.23.4, so its scripts run on the Bun runtime (`bun --bun astro …`).
- **Storage:** an in-memory mock behind `CheckStore` / `CorpusStore` interfaces shaped like the [decision 001](001-private-logs-schema.md) tables. Supabase replaces one file later.
- **Second channel:** a messaging bot (WhatsApp or similar) replaces Discord as the planned second channel. It is a future adapter over the same core. (Platforms and library chosen in [decision 007](007-messaging-bot-chat-sdk.md): Discord, WhatsApp and Messenger on the Vercel Chat SDK.)

Rejected: putting the pipeline inside the API app (it would block moving off Deno Deploy and sharing it with the bot); starting with Supabase (the user wants the logic first).

Affects: [architecture/codebase.md](../architecture/codebase.md), [architecture/stack-direction.md](../architecture/stack-direction.md), [product/response-contract.md](../product/response-contract.md).
