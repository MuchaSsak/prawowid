/**
 * The HTTP surface outside the platform webhooks: the root and favicon (browsers, Vercel's
 * post-deploy probe) and booting without BOT_ID_SECRET, which must degrade to a 503 instead of
 * crashing the whole function (FUNCTION_INVOCATION_FAILED on every route, 2026-11-21).
 */
import { describe, expect, test } from "bun:test";
import { createApp } from "../src/routes.js";
import { createClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";

const env: Record<string, string> = {
  FACEBOOK_APP_SECRET: "fb-secret",
  FACEBOOK_PAGE_ACCESS_TOKEN: "fb-token",
  FACEBOOK_VERIFY_TOKEN: "verify-me",
  PRAWDOWID_API_URL: "https://api.test",
};

function app(idSecret: string | null) {
  const config = loadConfig({ get: (k) => env[k] });
  return createApp({ config, client: createClient(config), idSecret, waitUntil: () => {}, runtime: "bun" });
}
const get = (a: ReturnType<typeof app>, path: string) => a.fetch(new Request(`https://bot.test${path}`));

describe("root routes", () => {
  test("GET / answers 200 with a pointer to /health", async () => {
    const res = await get(app("s"), "/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ service: "Prawdomat bot", see: "GET /health" });
  });

  test("GET /favicon.ico answers 204 with no body", async () => {
    const res = await get(app("s"), "/favicon.ico");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("unknown paths still 404", async () => {
    expect((await get(app("s"), "/nope")).status).toBe(404);
  });
});

describe("without BOT_ID_SECRET", () => {
  test("/health boots and names what is missing, without values", async () => {
    const res = await get(app(null), "/health");
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.missing).toEqual(["BOT_ID_SECRET"]);
    expect(JSON.stringify(body)).not.toContain("fb-secret");
  });

  test("webhooks refuse with 503 instead of using a random key", async () => {
    const res = await get(app(null), "/webhooks/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "bot not configured", missing: ["BOT_ID_SECRET"] });
  });

  test("with the secret, /health is ok and lists nothing missing", async () => {
    const res = await get(app("s"), "/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.missing).toEqual([]);
  });
});
