# 007: The messaging bot uses the Vercel Chat SDK for Discord, WhatsApp and Messenger, over the HTTP API
Date: 2026-11-21 · Status: decided (user)

Context: the user asked for a bot API on the Vercel Chat SDK covering Discord, WhatsApp and Messenger, using the mock API for now. [Decision 004](004-first-build-stack.md) named "a messaging bot (WhatsApp or similar)" as the second channel without choosing a library or platforms.

Decision:
- **One bot service**, built on the Vercel Chat SDK (`chat` plus the official `@chat-adapter/discord`, `/whatsapp` and `/messenger` adapters). One handler serves all three platforms.
- The bot is a **channel adapter over the HTTP API** (`POST /api/v1/check`, `X-Client-Key`, `X-End-User`). It never imports the core (hard constraint 18).
- **The API decides mock vs live** (`PRAWDOWID_MODE` on the API), not a bot flag, so the web app and the bot give the same answer (scenario G). The one exception is `MOCK_CLIENTS=bot`, which holds the bot in mock until its spend caps exist, so the web app can go live independently.
- **Hosting: Vercel Hobby, functions in `fra1`, Upstash Redis in the EU** (user, 2026-11-21). Discord is used through **slash commands only**, which arrive over HTTP, and WhatsApp and Messenger are plain webhooks, so no long-running process is needed. Vercel, Discord and Meta are US processors: `fra1` is the compute region, not EU data residency.
- **Build order: Discord first** (the only platform the jury can test without us; no Meta onboarding, no Redis), then WhatsApp (time-boxed), then Messenger as a stretch. Council review, 2026-11-21.
- Design: [architecture/messaging-bot.md](../architecture/messaging-bot.md). A prototype was built and then removed (user, 2026-11-21); the design stands and is not implemented yet.

Rejected: a separate bot per platform (three codebases, and replies would drift between channels); Discord DMs and @mentions on Vercel (the Gateway needs a cron job re-opening it every 9 minutes, and Hobby allows crons at most once a day, so it would need Pro); Cloudflare Workers (cannot hold the Gateway, and the SDK on Workers is unverified); a European container host such as Scaleway (EU-owned, but more setup; the fallback if EU ownership becomes a requirement); running the bot inside the Deno API (the SDK does not document Deno support, and it would couple the channel to the API runtime).

Affects: [architecture/messaging-bot.md](../architecture/messaging-bot.md), [architecture/codebase.md](../architecture/codebase.md), [hackathon/compliance-matrix.md](../hackathon/compliance-matrix.md).
