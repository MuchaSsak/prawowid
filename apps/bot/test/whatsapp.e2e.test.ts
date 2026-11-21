/**
 * WhatsApp through the real Chat SDK adapter, no network: Meta's GET handshake, a signed message
 * webhook (X-Hub-Signature-256), a retried delivery (deduped), and the reply sent to the Graph API.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CheckRequest } from "@prawdowid/core/types";
import { mockResponse } from "../../../packages/core/src/mock/fixtures.js";
import { createApp } from "../src/app.js";
import { createClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { setLogSink } from "../src/log.js";

const env: Record<string, string> = {
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_APP_SECRET: "wa-secret",
  WHATSAPP_PHONE_NUMBER_ID: "1000",
  WHATSAPP_VERIFY_TOKEN: "verify-me",
  PRAWDOWID_API_URL: "https://api.test",
};
const realFetch = globalThis.fetch;
const graph: { url: string; body: Record<string, unknown> }[] = [];
const api: CheckRequest[] = [];
const background: Promise<unknown>[] = [];
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  Object.assign(process.env, env);
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.test/api/v1/check")) {
      const req = JSON.parse(String(init.body)) as CheckRequest;
      api.push(req);
      return Response.json(mockResponse(req));
    }
    if (url.startsWith("https://api.test/api/v1/health")) return Response.json({ mode: "mock" });
    if (url.startsWith("https://graph.facebook.com/")) {
      graph.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : {} });
      return Response.json({ messages: [{ id: "wamid.out" }] });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  setLogSink(() => {});
  const config = loadConfig({ get: (k) => env[k] });
  app = createApp({ config, client: createClient(config), idSecret: "s", waitUntil: (t) => void background.push(t), runtime: "bun" });
});
afterAll(() => {
  globalThis.fetch = realFetch;
  setLogSink((l) => console.log(l));
});

async function signedPost(body: unknown) {
  const raw = JSON.stringify(body);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("wa-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return app.fetch(new Request("https://bot.test/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sig}` },
    body: raw,
  }));
}

const textMessage = (id: string, text: string) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: "waba",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "48000000000", phone_number_id: "1000" },
        contacts: [{ profile: { name: "Tester" }, wa_id: "48500100200" }],
        messages: [{ from: "48500100200", id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
      },
    }],
  }],
});

describe("WhatsApp over the real SDK", () => {
  test("Meta GET handshake echoes the challenge only with the right verify token", async () => {
    const ok = await app.fetch(new Request("https://bot.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(await ok.text()).toBe("12345");
    const bad = await app.fetch(new Request("https://bot.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  test("A5/A6: a signed text message is answered once, even when Meta retries it", async () => {
    const msg = textMessage("wamid.in.1", "demo:misleading");
    expect((await signedPost(msg)).status).toBe(200);
    expect((await signedPost(msg)).status).toBe(200); // retry
    await Promise.all(background.splice(0));
    const replies = graph.filter((g) => g.body.type === "text");
    expect(replies).toHaveLength(1);
    const text = String((replies[0].body.text as { body: string }).body);
    expect(text.startsWith("🧪 *DANE DEMO*")).toBe(true);
    expect(text).toContain("WPROWADZAJĄCE W BŁĄD");
    expect(text).not.toContain("<https://"); // raw text, no SDK markdown wrapping
    expect(api).toHaveLength(1);
    expect(JSON.stringify(api)).not.toContain("48500100200");
  });

  test("a bad signature is refused", async () => {
    const res = await app.fetch(new Request("https://bot.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=00" },
      body: JSON.stringify(textMessage("wamid.in.2", "x")),
    }));
    expect(res.status).toBe(401);
  });
});
