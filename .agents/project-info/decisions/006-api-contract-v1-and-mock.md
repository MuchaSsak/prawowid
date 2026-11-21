# 006: API contract v1 is frozen, and a mock mode serves it before the backend is ready
Date: 2026-11-21 · Status: decided (user)

Context: RAG and Supabase are not ready, but the team wants to deploy on Deno Deploy now and Fabian wants to start the messaging bot. The user asked for dummy data whose structures will not change when the real backend arrives.

Decision:
- Routes live under `/api/v1/*`; every response carries `contract_version: "1.0"` and `meta.mode: "live" | "mock"`. `GET /api/v1/schema` serves the JSON Schema generated from the same zod schemas the tests use.
- v1 is additive-only. Breaking changes need `/api/v2`.
- **Mock mode** returns fixtures in the exact v1 shape: per request (`mock`, or a `demo:<scenario>` text) or for the whole deployment (`PRAWDOWID_MODE=mock`). Fixtures are clearly synthetic (fictional town, example.org sources, `[DEMO]`, a first `demo_data` warning), so a mock can never be mistaken for a real verdict (hard constraints 1-2).
- Server clients (the bot) authenticate with `X-Client-Key` and are rate limited per `X-End-User`.

Rejected: mock data about real topics with real-looking sources (could leak into a demo as a fabricated verdict, a gate violation); a separate mock server (two codebases would drift; one API with a mode keeps the contract single-sourced).

Affects: [architecture/api-reference.md](../architecture/api-reference.md), [product/response-contract.md](../product/response-contract.md), [architecture/codebase.md](../architecture/codebase.md).
