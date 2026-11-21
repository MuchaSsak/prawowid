/**
 * The bot's HTTP surface, one Hono app behind one catch-all function (messaging-bot.md, Webhooks):
 *   GET  /health                   enabled platforms and the API URL (never secrets)
 *   POST /webhooks/discord         Discord Interactions endpoint (slash commands, PING)
 *   GET  /webhooks/whatsapp        Meta verification handshake (hub.verify_token)
 *   POST /webhooks/whatsapp        WhatsApp Cloud API messages
 *   GET  /webhooks/messenger       Meta verification handshake
 *   POST /webhooks/messenger       Messenger messages
 * The SDK verifies the signature and answers the platform at once; the check finishes in
 * `waitUntil`. `/health?deep=1` (token-protected, mock round-trip, Redis) comes with M1b.
 */
import { Hono } from "hono";
import type { Platform } from "./config.ts";
import { getChat, type PlatformDeps } from "./platforms.ts";

export type WaitUntil = (task: Promise<unknown>) => void;
type WebhookHandler = (req: Request, opts?: { waitUntil?: WaitUntil }) => Promise<Response>;

export function createApp(deps: PlatformDeps & { waitUntil: WaitUntil; runtime: "vercel" | "bun" }) {
  const { config, waitUntil, runtime } = deps;
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "Prawdowid bot",
      runtime,
      platforms: config.enabled,
      api_url: config.apiUrl,
      client_key: Boolean(config.clientKey),
      state: "memory",
    }));

  app.on(["GET", "POST"], "/webhooks/:platform", async (c) => {
    const platform = c.req.param("platform") as Platform;
    if (!config.enabled.includes(platform)) return c.json({ error: "platform not configured" }, 404);
    const chat = await getChat(platform, deps);
    const handler = (chat.webhooks as Record<string, WebhookHandler>)[platform];
    return handler(c.req.raw, { waitUntil });
  });

  app.notFound((c) => c.json({ error: "not found", see: "GET /health" }, 404));
  return app;
}
