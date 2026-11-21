// API routes through app.fetch (no server, no network, mock mode only).
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { CheckResponseSchema } from "@prawdowid/core";
import { app } from "./main.ts";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(new Request("http://x/api/v1/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));

Deno.test("POST /api/v1/check with mock returns a valid mock response", async () => {
  const res = await post({ input: { type: "text", value: "demo:mixed" }, mock: true });
  assertEquals(res.status, 200);
  const json = await res.json();
  assert(CheckResponseSchema.safeParse(json).success);
  assertEquals(json.meta.mode, "mock");
  assertEquals(json.claims.length, 3);
});

Deno.test("POST /api/v1/check rejects a body without input", async () => {
  const res = await post({ hello: 1 });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).status, "input_rejected");
});

Deno.test("GET /api/v1/schema and /api/v1/mock/scenarios", async () => {
  const schema = await (await app.fetch(new Request("http://x/api/v1/schema"))).json();
  assertEquals(schema.contract_version, "1.0");
  assert(schema.response.properties.claims);
  const sc = await (await app.fetch(new Request("http://x/api/v1/mock/scenarios"))).json();
  assert(sc.scenarios.partial);
});

Deno.test("old unversioned routes are gone", async () => {
  assertEquals((await app.fetch(new Request("http://x/api/check", { method: "POST" }))).status, 404);
});
