/**
 * Vercel entry (zero-config Hono: the default export of src/index.ts). One function in fra1 serves
 * every route (vercel.json); a check keeps running after the webhook is answered, via waitUntil.
 * Discord works through slash commands only: DMs and @mentions need the Gateway (decision 007).
 */
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app.ts";
import { createClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { resolveIdSecret } from "./pseudonym.ts";

const config = loadConfig({ get: (k) => process.env[k] });
// Production must have a stable HMAC key: a random one would orphan sessions on every cold start.
const idSecret = resolveIdSecret(config.idSecret, false);

export default createApp({ config, client: createClient(config), idSecret, waitUntil, runtime: "vercel" });
