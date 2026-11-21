/**
 * Long-running Bun server with the same routes as the Vercel entry: local development behind a
 * tunnel, or any container host (the EU fallback in decision 007).   bun run bot:dev
 */
import { createApp, type WaitUntil } from "./app.js";
import { createClient } from "./client.js";
import { loadConfig } from "./config.js";
import { resolveIdSecret } from "./pseudonym.js";

const config = loadConfig({ get: (k) => process.env[k] });
if (!config.idSecret) console.warn("[bot] BOT_ID_SECRET is not set: using a random key, so sessions reset on restart");
const idSecret = resolveIdSecret(config.idSecret, true);

/** In a long-running process "after the response" just means "don't await". */
const waitUntil: WaitUntil = (task) => {
  task.catch(() => console.error(JSON.stringify({ msg: "background_task_failed" })));
};

const app = createApp({ config, client: createClient(config), idSecret, waitUntil, runtime: "bun" });

if (import.meta.main) {
  if (config.enabled.length === 0) {
    console.warn("[bot] no platform configured: set the env vars from apps/bot/README.md (webhooks return 404 until then)");
  }
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`Prawdomat bot on http://localhost:${config.port}  platforms=${config.enabled.join(",") || "none"}  api=${config.apiUrl}`);
}

export { app };
