/// <reference lib="deno.unstable" />
import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { type CheckLogRow, mockResponse } from "@prawdowid/core";
import { createModeratorNotifier, notifyModerator } from "./moderator-alert.ts";

const claimText = "Prywatna treść pytania";
const recipient = "100000000000000001";
const channel = "100000000000000002";
const message = "100000000000000003";

function fixture() {
  const result = mockResponse({ input: { type: "text", value: claimText }, mock: "escalation" });
  result.claims[0].text = claimText;
  const row: CheckLogRow = {
    check_id: result.check_id,
    session_hash: "first-session",
    channel: "web",
    input_type: "text",
    masked_input: claimText,
    status: "ok",
    claims: [{
      id: result.claims[0].id,
      verdict: "insufficient_evidence",
      system_state: null,
      source_ids: [],
      class: "fact",
      text: claimText,
      type: result.claims[0].type,
    }],
    latency_ms: 1,
    models: [],
    prompt_versions: [],
    cost_usd: 0,
    created_at: new Date().toISOString(),
  };
  return { result, row };
}

async function exercise(
  run: (deps: {
    options: Parameters<typeof notifyModerator>[0];
    rows: CheckLogRow[];
    calls: { url: string; body: Record<string, unknown> }[];
  }) => Promise<void>,
) {
  const { result, row } = fixture();
  const kv = await Deno.openKv(":memory:");
  const rows = [row];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  try {
    await run({
      options: {
        result,
        kv,
        store: { listRecent: () => Promise.resolve(rows) },
        discord: { recipient, token: "test-token" },
        hash: () => Promise.resolve("123456789012345678901234567890"),
        fetchDiscord: async (url, init) => {
          const body = JSON.parse(await new Response(init?.body).text());
          calls.push({ url: String(url), body });
          return Response.json({ id: "recipient_id" in body ? channel : message });
        },
      },
      rows,
      calls,
    });
  } finally {
    kv.close();
  }
}

const needsKv = typeof Deno.openKv !== "function";

Deno.test(
  { name: "moderator DM sends once and includes only the reason and ID", ignore: needsKv },
  async () => {
    await exercise(async ({ options, calls }) => {
      await Promise.all([notifyModerator(options), notifyModerator(options)]);
      await notifyModerator(options);
      assertEquals(calls.map(({ url }) => new URL(url).pathname), [
        "/api/v10/users/@me/channels",
        `/api/v10/channels/${channel}/messages`,
      ]);
      assertEquals(calls[0].body, { recipient_id: recipient });
      assertEquals(
        calls[1].body.content,
        [
          "Prawdomat · Sprawdzenie wymaga uwagi",
          "Powód: Brak wystarczających dowodów w sprawie wysokiego ryzyka.",
          `ID sprawdzenia: ${options.result.check_id}`,
        ].join("\n"),
      );
    });
  },
);

Deno.test({ name: "repeated claim needs two saved sessions", ignore: needsKv }, async () => {
  await exercise(async ({ options, rows, calls }) => {
    options.result.claims[0].risk = "normal";
    rows.push({ ...rows[0], check_id: "earlier-check-same-session" });
    await notifyModerator(options);
    assertEquals(calls.length, 0);

    rows.push({ ...rows[0], check_id: "earlier-check-different-session", session_hash: "another-session" });
    await notifyModerator(options);
    assertEquals(calls.length, 2);
    assertEquals(String(calls[1].body.content).includes("Dwie sesje"), true);
  });
});

Deno.test({ name: "Discord errors do not mark an alert as sent", ignore: needsKv }, async () => {
  await exercise(async ({ options }) => {
    options.fetchDiscord = () => Promise.resolve(new Response(null, { status: 403 }));
    await assertRejects(() => notifyModerator(options), Error, "Discord rejected request (403)");
    const entries = await Array.fromAsync(options.kv.list({ prefix: ["prawdowid", "moderator_alert_v1"] }));
    assertEquals(entries.map(({ value }) => value), [{ state: "sending" }]);
  });
});

Deno.test("moderator alerts stay off without the bot credential", () => {
  const notify = createModeratorNotifier(
    (key) => key === "MODERATOR_DISCORD_USER_ID" ? recipient : undefined,
    {
      listRecent: () => {
        throw new Error("disabled alert should not look up checks");
      },
    },
    () => {
      throw new Error("disabled alert should not hash claims");
    },
  );
  notify(fixture().result);
});
