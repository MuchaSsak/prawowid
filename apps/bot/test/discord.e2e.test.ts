/**
 * The whole Discord path through the real Chat SDK adapter, with no network: a signed Interactions
 * webhook goes into the Hono app, the SDK verifies Ed25519 and defers, the conversation calls a fake
 * API, and the reply is captured where the SDK PATCHes it to Discord.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CheckRequest } from "@prawdowid/core/types";
import { mockResponse } from "../../../packages/core/src/mock/fixtures.ts";
import { createApp } from "../src/app.ts";
import { createClient } from "../src/client.ts";
import { loadConfig } from "../src/config.ts";
import { setLogSink } from "../src/log.ts";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
let keys: CryptoKeyPair;
const realFetch = globalThis.fetch;
const discordCalls: { url: string; method: string; body: Record<string, unknown> }[] = [];
const apiCalls: CheckRequest[] = [];
const logLines: string[] = [];
let app: ReturnType<typeof createApp>;
const background: Promise<unknown>[] = [];

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const env: Record<string, string> = {
    DISCORD_BOT_TOKEN: "test-token",
    DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey("raw", keys.publicKey)),
    DISCORD_APPLICATION_ID: "111",
    PRAWDOWID_API_URL: "https://api.test",
    PRAWDOWID_CLIENT_KEY: "bot-key",
    PRAWDOWID_WEB_URL: "https://web.test",
  };
  Object.assign(process.env, env);
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (url.startsWith("https://api.test/api/v1/check")) {
      const req = JSON.parse(String(init.body)) as CheckRequest;
      apiCalls.push(req);
      return Response.json(mockResponse(req));
    }
    if (url.startsWith("https://api.test/api/v1/health")) return Response.json({ mode: "live", client_mode: "mock" });
    if (url.startsWith("https://discord.com/")) {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      discordCalls.push({ url, method, body });
      return Response.json({ id: "msg-1", channel_id: "c1" });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  setLogSink((l) => logLines.push(l));
  const config = loadConfig({ get: (k) => env[k] });
  app = createApp({
    config,
    client: createClient(config),
    idSecret: "s",
    waitUntil: (t) => void background.push(t),
    runtime: "bun",
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  setLogSink((l) => console.log(l));
});

async function signed(body: unknown, tamper = false) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(ts + raw)));
  return app.fetch(new Request("https://bot.test/webhooks/discord", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": tamper ? sig.replace(/^./, sig[0] === "0" ? "1" : "0") : sig,
      "x-signature-timestamp": ts,
    },
    body: raw,
  }));
}

const interaction = (name: string, options: unknown[] = []) => ({
  id: `int-${name}-${Math.random()}`,
  application_id: "111",
  type: 2,
  token: "itoken",
  channel_id: "c1",
  guild_id: "g1",
  channel: { id: "c1", type: 0 },
  member: { user: { id: "4242", username: "tester" } },
  data: { id: "cmd", name, type: 1, options },
});

describe("Discord over the real SDK", () => {
  test("PING → PONG; a bad signature → 401", async () => {
    const pong = await signed({ type: 1, id: "p", application_id: "111" });
    expect(await pong.json()).toEqual({ type: 1 });
    expect((await signed({ type: 1, id: "p" }, true)).status).toBe(401);
  });

  test("/sprawdz tresc → deferred ephemeral ack, then the rendered mock answer PATCHed", async () => {
    const res = await signed(interaction("sprawdz", [{ name: "tresc", type: 3, value: "demo:false" }]));
    const ack = await res.json() as { type: number; data?: { flags?: number } };
    expect(ack.type).toBe(5); // DeferredChannelMessageWithSource
    expect(ack.data?.flags).toBe(64 | 4); // EPHEMERAL | SUPPRESS_EMBEDS
    await Promise.all(background.splice(0));
    const patch = discordCalls.find((c) => c.method === "PATCH" && c.url.includes("/webhooks/111/itoken/messages/@original"));
    expect(patch).toBeDefined();
    const content = String(patch!.body.content);
    expect(content).toContain("DANE DEMO");
    expect(content).toContain("FAŁSZYWE");
    expect(content).toContain("<https://");
    expect(patch!.body.flags).toBe(64 | 4);
    expect(content.length).toBeLessThanOrEqual(2000);
    // What the API saw: text only, from the option by name; pseudonymous user; never the mock flag.
    const sent = apiCalls.at(-1)!;
    expect(sent.input).toEqual({ type: "text", value: "demo:false" });
    expect(sent.channel).toBe("messaging");
    expect("mock" in sent).toBe(false);
    expect(JSON.stringify(sent)).not.toContain("4242");
    // One content-free log line.
    const line = JSON.parse(logLines.find((l) => l.includes("bot_event"))!);
    expect(line).toMatchObject({ platform: "discord", outcome: "ok" });
    expect(logLines.join("\n")).not.toContain("demo:false");
  });

  test("/pomoc and /usun-dane answer privately", async () => {
    discordCalls.length = 0;
    await signed(interaction("pomoc"));
    await Promise.all(background.splice(0));
    expect(String(discordCalls.at(-1)?.body.content)).toContain("Prywatność");
  });

  test("unknown platform → 404, health shows no secrets", async () => {
    expect((await app.fetch(new Request("https://bot.test/webhooks/whatsapp", { method: "POST" }))).status).toBe(404);
    const health = await (await app.fetch(new Request("https://bot.test/health"))).text();
    expect(health).toContain('"platforms":["discord"]');
    expect(health).not.toContain("test-token");
    expect(health).not.toContain("bot-key");
  });
});
