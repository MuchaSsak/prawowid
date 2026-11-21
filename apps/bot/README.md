# Prawdomat bot

One bot for Discord (slash commands), WhatsApp and Messenger on the [Vercel Chat SDK](https://chat-sdk.dev/docs). It is a channel adapter over the Prawdomat HTTP API (`POST /api/v1/check`) and never imports the verification core. The API decides mock vs live. Design: `.agents/project-info/architecture/messaging-bot.md`. Setup, env vars and acceptance tests: `.agents/project-info/architecture/messaging-bot-runbook.md`.

## Try it without any platform account (console channel)
From the repo root:
```bash
bun install
bun run bot:console "Polska ma 38 milionów mieszkańców"          # against the deployed API
bun run bot:console --as discord "demo:mixed"                     # shows the reply the way Discord would
bun run bot:console --image zrzut.png "czy to prawda?"            # a screenshot
bun run bot:console                                               # interactive
```
For synthetic demo answers, run the API in mock mode and point the bot at it:
```bash
PRAWDOWID_MODE=mock bun run api:dev                               # terminal 1
PRAWDOWID_API_URL=http://localhost:8787 bun run bot:console "demo:false"   # terminal 2
```
`demo:<scenario>` is refused locally when the API answers live, so a synthetic prompt never runs as a real check. Scenarios: `GET /api/v1/mock/scenarios`.

## Run the webhook server
- `bun run bot:dev`: a Bun server on `http://localhost:8788` (`BOT_PORT`). Put it behind a tunnel to test with real platforms.
- Vercel: Root Directory `apps/bot`, entry `src/index.ts` (zero-config Hono; the entry must import `hono` itself), region `fra1`, `maxDuration` 300 s (`vercel.json`). Register **only the production URL** on the platforms.

Routes: `GET /health`, `POST /webhooks/discord`, `GET|POST /webhooks/whatsapp`, `GET|POST /webhooks/messenger`. A platform is enabled only when all its env vars are set (see `.env.example`).

Discord commands are registered per server: `bun run bot:discord:commands` (needs `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`).

## Hold the bot in mock while the API is live
On the API (Deno Deploy): `CLIENT_KEYS=bot:<key>` and `MOCK_CLIENTS=bot`. On the bot: `PRAWDOWID_CLIENT_KEY=<key>`. The bot then gets mock answers (with the demo banner) while the web app gets live ones. Removing `bot` from `MOCK_CLIENTS` is the bot's live switch.

## Code
| File | Role |
|---|---|
| `src/conversation.ts` | the conversation shared by every platform: intake → API → validate → render; guaranteed reply, 45 s deadline |
| `src/intake.ts`, `src/image.ts` | message → check / command / local reply; capped image fetch, type from the first bytes |
| `src/client.ts`, `src/validate.ts` | the API client (never sends `mock`) and the bundled structural contract check |
| `src/render.ts`, `src/sanitize.ts` | the short chat form per platform; every response string made inert |
| `src/platforms.ts` | one Chat SDK instance per platform, loaded on first webhook; Discord options read by name |
| `src/routes.ts`, `src/index.ts`, `src/local.ts` | Hono routes; Vercel entry; Bun server. Never add a `src/app.ts`: Vercel's Hono zero-config takes it as the entrypoint ahead of `src/index.ts` |
| `src/console.ts` | the console channel |
| `src/log.ts`, `src/pseudonym.ts` | content-free log lines and SDK logger; HMAC pseudonyms |

Tests: `bun run bot:test` (no network: renders every mock scenario on every platform, sanitizer, intake and image limits, timeouts, and signed Discord and WhatsApp webhooks through the real SDK).

Not built yet (milestone M1b): Upstash Redis (cross-instance dedupe, the 30/day quota, outcome counters), `/health?deep=1` with a token, the consistency script.
