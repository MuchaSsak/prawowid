/**
 * The bot's HTTP surface, one Hono app behind one catch-all function (messaging-bot.md, Webhooks):
 *   GET  /                         a short pointer to /health (browsers, Vercel's post-deploy probe)
 *   GET  /favicon.ico              204, so browser visits don't log as errors
 *   GET  /health                   enabled platforms, the API URL and missing required env names (never values)
 *   POST /webhooks/discord         Discord Interactions endpoint (slash commands, PING)
 *   GET  /webhooks/messenger       Meta verification handshake
 *   POST /webhooks/messenger       Messenger messages
 * The SDK verifies the signature and answers the platform at once; the check finishes in
 * `waitUntil`. `/health?deep=1` (token-protected, mock round-trip, Redis) comes with M1b.
 * Without `BOT_ID_SECRET` (idSecret null) the app still boots, so `/health` can say what is missing,
 * but webhooks answer 503: production never falls back to a random pseudonym key.
 */
import { Hono } from "hono";
import type { Platform } from "./config.js";
import { getChat, type PlatformDeps } from "./platforms.js";

export type WaitUntil = (task: Promise<unknown>) => void;
type WebhookHandler = (req: Request, opts?: { waitUntil?: WaitUntil }) => Promise<Response>;

type AppDeps = Omit<PlatformDeps, "idSecret"> & {
  idSecret: string | null;
  waitUntil: WaitUntil;
  runtime: "vercel" | "bun";
};

export function createApp(deps: AppDeps) {
  const { config, waitUntil, runtime, idSecret } = deps;
  const platformDeps: PlatformDeps | null = idSecret ? { ...deps, idSecret } : null;
  const missing = idSecret ? [] : ["BOT_ID_SECRET"];
  const app = new Hono();

  app.get("/", (c) => c.json({ service: "Prawdomat bot", see: "GET /health" }));
  app.get("/favicon.ico", (c) => c.body(null, 204));

  app.get("/health", (c) =>
    c.json({
      ok: missing.length === 0,
      service: "Prawdomat bot",
      runtime,
      platforms: config.enabled,
      api_url: config.apiUrl,
      client_key: Boolean(config.clientKey),
      missing,
      state: "memory",
    }, missing.length === 0 ? 200 : 503));

  app.on(["GET", "POST"], "/webhooks/:platform", async (c) => {
    const platform = c.req.param("platform") as Platform;
    if (!config.enabled.includes(platform)) return c.json({ error: "platform not configured" }, 404);
    if (!platformDeps) return c.json({ error: "bot not configured", missing }, 503);
    const chat = await getChat(platform, platformDeps);
    const handler = (chat.webhooks as Record<string, WebhookHandler>)[platform];
    return handler(c.req.raw, { waitUntil });
  });

  app.notFound((c) => c.json({ error: "not found", see: "GET /health" }, 404));
  return app;
}
