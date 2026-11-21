# Messaging bot runbook: setup, env vars, acceptance tests, demo day
How to bring up the bot designed in [messaging-bot.md](messaging-bot.md) and keep it working through judging. Status: M1 code in `apps/bot`, deployed at https://prawdomat-bot.vercel.app, platform setup in progress ([implementation status](messaging-bot.md#implementation-status-2026-11-21)). Timeline, gates and cut line: [messaging-bot.md § Milestones](messaging-bot.md#milestones-and-cut-line).

## Env vars (Vercel project settings, production only)
| Variable | Secret | Needed from | Purpose |
|---|---|---|---|
| `PRAWDOWID_API_URL` | no | M1 | the API base URL (https://prawowid.mateusz.deno.net) |
| `PRAWDOWID_CLIENT_KEY` | yes | M1 | must match an entry in the API's `CLIENT_KEYS` (set on Deno Deploy too). Never in the README or the console instructions |
| `BOT_ID_SECRET` | yes | M1 | HMAC key for the user pseudonym (generate with `openssl rand -hex 32`). Don't rotate it during the event (rotation orphans sessions and quotas). Without it the function still boots, but `/health` answers 503 with `missing: ["BOT_ID_SECRET"]` and every webhook answers 503 |
| `REDIS_URL` | yes | M1b | set by the Upstash integration (dedupe, daily quota, outcome counters) |
| `HEALTH_TOKEN` | yes | M1b | sent as `Authorization: Bearer …` to `/health?deep=1`; only the uptime monitor holds it |
| `PRAWDOWID_WEB_URL` | no | M1 | the web app link in every reply's footer: `https://prawdomat.vercel.app` (the web app, Vercel project `prawdomat`, deployed from `main`; checked 2026-11-21) |
| `BOT_PRIVACY_CONTACT` | no | M1 | the data controller and contact e-mail shown in `/pomoc` (blocks the invite gate until set) |
| `DISCORD_GUILD_ID` | no | M1 | the demo server; used only by `bun run bot:discord:commands` |
| `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` | yes / no / no | M1 | Discord app (the adapter requires the token, and command registration uses it) |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | yes / yes / no / yes | M2 | WhatsApp Cloud API |
| `FACEBOOK_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_VERIFY_TOKEN` | yes | M3 | Messenger |

On the API (Deno Deploy): `CLIENT_KEYS=bot:<key>`, `PRAWDOWID_MODE` (the web's mode, goes live independently) and `MOCK_CLIENTS=bot` (holds the bot in mock until its live gate). Only placeholders go in `.env.example` (hard constraint 11).

## Setup checklists
**Vercel (M1):**
- Import the repo and set Root Directory to the bot app.
- The repo lives on the `MuchaSsak` GitHub account, so only that account can link it to Vercel (another account's import fails with "install the GitHub integration first"). Owner task: [issue #6](https://github.com/MuchaSsak/prawowid/issues/6). Fallback without GitHub: `vercel` CLI from the repo root with code directory `apps/bot` and a `.vercelignore` excluding `.env*` (no auto-deploy on push).
- The Vercel projects (`prawdomat`, `prawdomat-bot`) sit on a Hobby team, which deploys only commits whose Git author is a team member. Commits by any other author (e.g. `RocketPLN`, PR #7) show "Deployment was blocked" / "Git author must have access" on the PR. That is an account limit, not a build failure: the code deploys once a member's commit (or the merge to `main` by the owner) triggers it. Fixes: owner merges or redeploys, the repo goes public, or the team upgrades to Pro and adds the author.
- Preset: Hono (zero-config, `src/index.ts`). Live project: `prawdomat-bot` → `https://prawdomat-bot.vercel.app` ([status](messaging-bot.md#implementation-status-2026-11-21)). Relative imports must use `.js`, or every route crashes with `ERR_MODULE_NOT_FOUND`. `PRAWDOWID_CLIENT_KEY` stays unset until the API has `CLIENT_KEYS` (the bot then shares the API's per-IP limit).
- One catch-all function for every route.
- After each deploy, open `https://<prod>/health`. It must be 200 with `ok: true`. A 503 lists the missing env names. A bare `500 FUNCTION_INVOCATION_FAILED` on every route means the function crashed on load: read the deployment's runtime log (2026-11-21: Vercel picked `src/app.ts` as the entrypoint, see [status](messaging-bot.md#implementation-status-2026-11-21)). `/` answers 200 and `/favicon.ico` 204, so Vercel's post-deploy probe and browser visits aren't errors.
- Fluid compute on (the default), region `fra1`, `maxDuration` 300 s.
- Register only the production URL on the platforms.

**Upstash (M1b):** run `vercel integration add upstash/upstash-kv` and pick `eu-central-1`. It sets `REDIS_URL`.

**Discord (M1):**
1. Create the application in the Developer Portal. Copy the bot token, public key and application id.
2. Deploy, then set the **Interactions Endpoint URL** to `https://<prod>/webhooks/discord`. Discord tests it with a PING and with a bad signature. Both must pass, or the portal won't save the URL.
3. Install it on the demo server with `applications.commands` plus `bot` with permissions = 0. Leave the `@everyone` role with its default "View Channel" in the demo channel, or REST calls made as the bot can return 403.
4. Register the commands **per server**, so they appear instantly (`bun run bot:discord:commands`):
   - `/sprawdz` with options `tresc` (string) and `obraz` (attachment), both optional; the bot requires at least one.
   - (`/demo` was removed on 2026-11-21 when the bot went to live answers. Re-running the script replaces the server's command list, so an old `/demo` disappears.)
   - `/pomoc`.
   - `/usun-dane`.
5. Make a public invite link. It goes into the README at the invite gate: M1 passes in mock mode and the privacy contact is filled in.

**WhatsApp (M2, time-box 1 h; only after Redis exists, M1b):**
1. Create a Meta app with the WhatsApp product and a business portfolio. Use the test number.
2. Set the webhook URL to `https://<prod>/webhooks/whatsapp` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Subscribe the `messages` and `user_id_update` fields.
3. Add up to 5 test recipients (team phones).
4. Get a **permanent token** to replace the 24 h one: Business Settings → System Users.
   - Create an admin system user.
   - Assign it the app and the WhatsApp Business Account.
   - Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`, and set expiry to "never".

**Messenger (M3, stretch):**
1. Create a Facebook Page and add the Messenger product to the Meta app. Generate the Page access token.
2. Set the webhook URL to `https://<prod>/webhooks/messenger` and the verify token to `FACEBOOK_VERIFY_TOKEN`. Subscribe the Page to `messages` and `messaging_postbacks`.
3. Give each tester a role in the app; in dev mode it answers only them.
4. Set the privacy-policy URL to the privacy notice page.

**Uptime monitor (M1b):** any free external monitor.
- Poll `https://<prod>/health?deep=1` every 5 min with the header `Authorization: Bearer <HEALTH_TOKEN>`, with e-mail or Discord alerts.
- Because the whole bot is one function, the poll may also keep an instance warm for the Discord ack (best effort; Vercel doesn't document idle lifetime).
- After M-live, also poll the API's `/api/v1/health`.
- Alert when the hourly `technical_error` count in `/health?deep=1` exceeds 3.

## Acceptance tests
Run against the production deployment with real accounts. Offline equivalents of A2, A3, A6, A7, A9, A10 and A11 already pass in `bun run bot:test`; they don't replace the production run. Record the results in [messaging-bot.md](messaging-bot.md) when they pass, so the prototype notes become confirmed facts.

| # | Test | Pass bar |
|---|---|---|
| A1 | Discord `/sprawdz` after 15 min idle (cold start), on a real server with the chosen install scope | deferred ack visible in < 2 s; answer in < 15 s (mock < 3 s); private to the asker; no link previews; no REST 403 in the logs |
| A2 | Discord `/sprawdz` with `tresc` **and** `obraz` together; then an image over 5 MB; then a non-image renamed to `.png` | the text has no attachment id in it; the big file is refused before the full download; the fake image is refused by its first bytes |
| A3 | Wrong API URL in env, then an API that hangs for 60 s; run `/sprawdz` | a system message within about 50 s, never "thinking…" forever |
| A4 | Two users run `/sprawdz` in the same channel at once | both get their own answer |
| A5 | WhatsApp text, link, a screenshot **with a caption**, and a screenshot without one | each answered once; the caption arrives as `user_message` |
| A6 | Replay the same signed Meta webhook twice | answered once (Redis dedupe) |
| A7 | `demo:false` (and ` DEMO:false`) while the API is live | a local reply, no synthetic answer |
| A8 | The consistency script, **fresh run** (`no-cache`); record the mode it ran in | same `status`, verdict labels and `source_id`s between the web path and the bot. In mock mode it is 100 % by construction, so only a live result counts as the metric. Report a live result below 100 % honestly, with the differing cases |
| A9 | `/usun-dane` after two checks | the count is reported with "(liczba przybliżona)"; the quota is **not** reset. The API side can't be fully verified while its store is in memory per instance |
| A10 | `/health?deep=1` without the header, then with it; a source title containing `@everyone`, a markdown link and a bare domain | 401 without the token; with it: API, mock round-trip and Redis OK, outcome counts shown, no secrets; the title shows up neutralized |
| A11 | Force an exception in a handler while sending a message with a recognizable text | the user gets the system message; the text appears in no Vercel log line |

## Demo day (Sunday)
- **09:30:** check the uptime monitor history. Run A1 and A5. Open a Vercel log tail.
- **10:00:** check the WhatsApp system-user token works. Confirm the WhatsApp and Messenger clips are in the video and the deck.
- **Pitch:** the senior-citizen story on WhatsApp (video), then Discord live.
- **Jury testing (Stage I, unattended):** the uptime monitor alerts the team. The Redis outcome counters (48 h) are the durable record of what the jury ran. The API's check log is volatile until Supabase lands.
- **If a webhook fails:** the user still gets a system message (A3). Switch to the video and the console channel.

## Shutdown after the event (hard constraint 14)
Do this by Sun 22.11 evening, unless the pilot path continues:
1. Revoke the WhatsApp system-user token and the Messenger Page token. Reset the Discord bot token.
2. Remove `bot:<key>` from the API's `CLIENT_KEYS`.
3. Delete the Upstash database.
4. Delete the API's bot sessions, or wait for the 30-day retention.
5. Remove the Vercel env secrets, or delete the project.
6. Record what was done in `log.md`.
