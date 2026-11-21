/**
 * Vercel entry (zero-config Hono: the default export of src/index.ts). Vercel's Hono detection
 * picks `src/app.*` ahead of this file, so the routes live in routes.ts: an `app.ts` without a
 * default export crashed every route ("Invalid export found in module", 2026-11-21). The build
 * also requires this file itself to import "hono" ("No entrypoint found which imports hono"), hence
 * the Hono import and the typed `app` below: don't remove them as unused.
 * One function in fra1 serves every route (vercel.json); a check keeps running after the webhook
 * is answered, via waitUntil.
 * Discord works through slash commands only: DMs and @mentions need the Gateway (decision 007).
 */
import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";
import { createApp } from "./routes.js";
import { createClient } from "./client.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ get: (k) => process.env[k] });
// Production must have a stable HMAC key: a random one would orphan sessions on every cold start.
// Never throw here: a crash at module load turns every route, /health included, into a bare 500
// (FUNCTION_INVOCATION_FAILED). Without the key the app boots, /health reports it and webhooks 503.
const idSecret = config.idSecret ?? null;
if (!idSecret) console.error("[bot] BOT_ID_SECRET is not set: webhooks answer 503 until it is");

const app: Hono = createApp({ config, client: createClient(config), idSecret, waitUntil, runtime: "vercel" });
export default app;
