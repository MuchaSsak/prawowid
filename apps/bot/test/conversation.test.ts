import { describe, expect, test } from "bun:test";
import type { CheckRequest } from "@prawdowid/core/types";
import { mockResponse } from "../../../packages/core/src/mock/fixtures.js";
import { createClient, type PrawdowidClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { converse, type Turn } from "../src/conversation.js";
import { sniffImage } from "../src/image.js";
import { toIntent } from "../src/intake.js";
import { logEvent, quietLogger, setLogSink } from "../src/log.js";
import { discordSlashToMessage, sdkMessageToIncoming } from "../src/platforms.js";
import { pseudonym } from "../src/pseudonym.js";

const config = loadConfig({ get: (k) => ({ PRAWDOWID_API_URL: "https://api.test", PRAWDOWID_CLIENT_KEY: "k" } as Record<string, string>)[k] });
const SECRET = "test-secret";
const signal = () => AbortSignal.timeout(5000);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

/** A fetch that plays the API in mock mode and records what the bot sent. */
function fakeApi(opts: { mode?: "live" | "mock"; hang?: boolean; body?: string } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: CheckRequest | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (opts.hang) {
      return await new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    if (url.endsWith("/api/v1/health")) return Response.json({ mode: "live", client_mode: opts.mode ?? "mock" });
    if (init.method === "DELETE") return Response.json({ deleted: true, checks: 2 });
    if (opts.body !== undefined) return new Response(opts.body, { status: 502 });
    const req = JSON.parse(String(init.body)) as CheckRequest;
    const res = mockResponse(req);
    if (opts.mode === "live") res.meta.mode = "live";
    return Response.json(res);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function deps(fetchImpl: typeof fetch, extra: Partial<{ deadlineMs: number; client: PrawdowidClient }> = {}) {
  return { config, client: extra.client ?? createClient(config, fetchImpl), idSecret: SECRET, fetchImpl, deadlineMs: extra.deadlineMs };
}
const turn = (text: string, surface: Turn["surface"] = "whatsapp", userId = "48500100200"): Turn => ({ surface, userId, message: { text } });

describe("conversation", () => {
  test("same input on two platforms → same verdict; only the HMAC pseudonym leaves the bot", async () => {
    const api = fakeApi();
    const a = await converse(turn("demo:false", "whatsapp"), deps(api.fetchImpl));
    const b = await converse(turn("demo:false", "messenger", "998877"), deps(api.fetchImpl));
    expect(a.text).toContain("FAŁSZYWE");
    expect(b.text).toContain("FAŁSZYWE");
    const check = api.calls.find((c) => c.url.endsWith("/api/v1/check"))!;
    const expected = await pseudonym(SECRET, "whatsapp", "48500100200");
    expect(check.headers["X-End-User"]).toBe(expected);
    expect(check.body?.session_id).toBe(expected);
    expect(check.headers["X-Client-Key"]).toBe("k");
    expect(check.body?.channel).toBe("messaging");
    expect(check.body && "mock" in check.body).toBe(false); // the API decides mock vs live
    expect(JSON.stringify(api.calls)).not.toContain("48500100200");
  });

  test("a rate-limited live answer doesn't flip the mode of a bot held in mock (MOCK_CLIENTS)", async () => {
    const api = fakeApi({ mode: "mock" });
    const client = createClient(config, api.fetchImpl);
    expect(await client.mode(signal())).toBe("mock");
    const res = await client.check({ input: { type: "text", value: "x" } }, "u", signal());
    expect(res.kind).toBe("response");
    // fakeApi answers checks with meta.mode "mock" here; force a live 429-style answer next:
    const live = createClient(config, (async (u: string | URL | Request, init?: RequestInit) => {
      if (String(u).endsWith("/api/v1/health")) return Response.json({ mode: "live", client_mode: "mock" });
      const r = mockResponse({ input: { type: "text", value: "x" } }, "rate_limited");
      r.meta.mode = "live";
      return Response.json(r, { status: 429 });
    }) as typeof fetch);
    expect(await live.mode(signal())).toBe("mock");
    await live.check({ input: { type: "text", value: "x" } }, "u", signal());
    expect(await live.mode(signal())).toBe("mock");
  });

  test("a slow mock answer landing after a newer live one doesn't bring mock back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const client = createClient(config, (async (_u: string | URL | Request, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body)) as CheckRequest;
      const r = mockResponse(req);
      if (req.input.value === "slow-mock") await gate; // sent first, answered last
      else r.meta.mode = "live";
      return Response.json(r);
    }) as typeof fetch);
    const slow = client.check({ input: { type: "text", value: "slow-mock" } }, "u", signal());
    await new Promise((r) => setTimeout(r, 5));
    await client.check({ input: { type: "text", value: "fast-live" } }, "u", signal());
    release();
    await slow;
    expect(await client.mode(signal())).toBe("live");
  });

  test("ordering is by request, not by clock: same-millisecond requests and a stale /health", async () => {
    const realNow = Date.now;
    Date.now = () => 1_000_000; // every request in the same millisecond
    try {
      let releaseCheck!: () => void;
      let releaseHealth!: () => void;
      const checkGate = new Promise<void>((r) => (releaseCheck = r));
      const healthGate = new Promise<void>((r) => (releaseHealth = r));
      const client = createClient(config, (async (u: string | URL | Request, init?: RequestInit) => {
        if (String(u).endsWith("/api/v1/health")) {
          await healthGate; // asked first, answered last, says mock
          return Response.json({ mode: "live", client_mode: "mock" });
        }
        const req = JSON.parse(String(init?.body)) as CheckRequest;
        const r = mockResponse(req);
        if (req.input.value === "slow-mock") await checkGate;
        else r.meta.mode = "live";
        return Response.json(r);
      }) as typeof fetch);
      const health = client.mode(signal());
      const slow = client.check({ input: { type: "text", value: "slow-mock" } }, "u", signal());
      await client.check({ input: { type: "text", value: "fast-live" } }, "u", signal());
      releaseCheck();
      await slow;
      releaseHealth();
      expect(await health).toBe("live"); // the stale /health answer returns the newer cached mode
      expect(await client.mode(signal())).toBe("live");
    } finally {
      Date.now = realNow;
    }
  });

  test("a switch from mock to live is picked up from the next 200 answer, so demo: is refused at once", async () => {
    let apiMode: "live" | "mock" = "mock";
    const calls: string[] = [];
    const client = createClient(config, (async (u: string | URL | Request, init?: RequestInit) => {
      calls.push(String(u));
      if (String(u).endsWith("/api/v1/health")) return Response.json({ mode: "live", client_mode: apiMode });
      const r = mockResponse(JSON.parse(String(init?.body)));
      r.meta.mode = apiMode;
      return Response.json(r);
    }) as typeof fetch);
    const d = { config, client, idSecret: SECRET };
    expect((await converse(turn("demo:false"), d)).text).toContain("FAŁSZYWE");
    apiMode = "live"; // the operator removes the bot from MOCK_CLIENTS
    await converse(turn("Ceny prądu wzrosły o 300%"), d);
    const before = calls.filter((c) => c.endsWith("/check")).length;
    expect((await converse(turn("demo:false"), d)).text).toContain("tylko w trybie demonstracyjnym");
    expect(calls.filter((c) => c.endsWith("/check")).length).toBe(before);
  });

  test("A7: demo:<scenario> while the API answers live → a local reply, no check sent", async () => {
    const api = fakeApi({ mode: "live" });
    for (const t of ["demo:false", "  DEMO:false"]) {
      const r = await converse(turn(t), deps(api.fetchImpl));
      expect(r.text).toContain("tylko w trybie demonstracyjnym");
    }
    expect(api.calls.some((c) => c.url.endsWith("/check"))).toBe(false);
  });

  test("A3: an API that hangs → the system message within the deadline, never silence", async () => {
    const api = fakeApi({ hang: true });
    const started = Date.now();
    const r = await converse(turn("Ceny prądu wzrosły o 300%"), deps(api.fetchImpl, { deadlineMs: 150 }));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.outcome).toBe("timeout");
    expect(r.text).toContain("To nie jest ocena treści");
  });

  test("an invalid body or a throwing client → technical_error notice, never a verdict", async () => {
    const r1 = await converse(turn("coś"), deps(fakeApi({ body: "<html>bad gateway</html>" }).fetchImpl));
    expect(r1.outcome).toBe("technical_error");
    expect(r1.text).toContain("To nie jest ocena treści");
    const throwing: PrawdowidClient = {
      check: () => Promise.reject(new Error("boom")),
      deleteSession: () => Promise.reject(new Error("boom")),
      mode: () => Promise.resolve("mock"),
    };
    const r2 = await converse(turn("coś"), deps(fakeApi().fetchImpl, { client: throwing }));
    expect(r2.outcome).toBe("technical_error");
  });

  test("a request-level system state is outcome system_state", async () => {
    const r = await converse(turn("demo:out_of_scope"), deps(fakeApi().fetchImpl));
    expect(r.outcome).toBe("system_state");
    expect(r.checkId).toBeTruthy();
  });

  test("A9: usuń dane deletes the pseudonym's session and reports an approximate count", async () => {
    const api = fakeApi();
    const r = await converse({ ...turn(""), command: "delete_data", surface: "discord", userId: "42" }, deps(api.fetchImpl));
    const del = api.calls.find((c) => c.method === "DELETE")!;
    expect(del.url).toContain(await pseudonym(SECRET, "discord", "42"));
    expect(r.text).toContain("Usunęliśmy 2 zapisanych sprawdzeń (liczba przybliżona)");
  });
});

describe("intake", () => {
  test("text, link + question, demo, commands (exact match only)", async () => {
    expect(await toIntent({ text: "Ceny prądu wzrosły o 300%." }, signal())).toEqual({
      kind: "check",
      demo: false,
      request: { input: { type: "text", value: "Ceny prądu wzrosły o 300%." } },
    });
    expect(await toIntent({ text: "czy to prawda? https://example.org/a?b=1" }, signal())).toEqual({
      kind: "check",
      demo: false,
      request: { input: { type: "url", value: "https://example.org/a?b=1" }, user_message: "czy to prawda?" },
    });
    const demo = await toIntent({ text: "demo:url https://x.org" }, signal());
    expect(demo.kind === "check" && demo.demo && demo.request.input.type).toBe("text");
    expect((await toIntent({ text: "Pomoc" }, signal())).kind).toBe("help");
    expect((await toIntent({ text: "Usuń  dane" }, signal())).kind).toBe("delete_data");
    expect((await toIntent({ text: "usuń dane z tego artykułu" }, signal())).kind).toBe("check");
    expect((await toIntent({ text: "", fromSlashCommand: true }, signal())).kind).toBe("local");
    expect((await toIntent({ text: "", ignore: true }, signal())).kind).toBe("ignore");
    expect((await toIntent({ text: "", unsupported: true }, signal())).kind).toBe("local");
  });

  test("magic bytes decide the image type", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  test("A2: Discord image: CDN allowlist, declared size, no redirects, streamed cap, fake image", async () => {
    const big = 6 * 1024 * 1024;
    const served: string[] = [];
    const cdn = (async (u: string | URL, init?: RequestInit) => {
      served.push(String(u));
      expect(init?.redirect).toBe("manual");
      const path = new URL(String(u)).pathname;
      if (path === "/redirect") return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
      if (path === "/fake.png") return new Response(new TextEncoder().encode("not an image at all"));
      if (path === "/stream.png") {
        // No Content-Length: the streamed read must stop at 5 MB.
        let sent = 0;
        return new Response(new ReadableStream({
          pull(c) {
            sent += 1024 * 1024;
            if (sent > big) c.close();
            else c.enqueue(new Uint8Array(1024 * 1024));
          },
        }));
      }
      return new Response(PNG);
    }) as typeof fetch;
    const img = (url: string, size?: number) => toIntent({ text: "", image: { kind: "discord", url, size }, fromSlashCommand: true }, signal(), cdn);
    expect(await img("https://evil.example/a.png")).toEqual({ kind: "local", reason: "image_fetch_failed" });
    expect(await img("https://cdn.discordapp.com/a.png", big)).toEqual({ kind: "local", reason: "image_too_large" });
    expect(served).toHaveLength(0); // refused before any download
    expect(await img("https://cdn.discordapp.com/redirect")).toEqual({ kind: "local", reason: "image_fetch_failed" });
    expect(await img("https://cdn.discordapp.com/fake.png")).toEqual({ kind: "local", reason: "not_an_image" });
    expect(await img("https://cdn.discordapp.com/stream.png")).toEqual({ kind: "local", reason: "image_too_large" });
    const ok = await img("https://media.discordapp.net/ok.png");
    expect(ok.kind === "check" && ok.request.input.value.startsWith("data:image/png;base64,")).toBe(true);
  });

  test("Meta image: size re-checked after the SDK download; caption → user_message", async () => {
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set(JPEG);
    expect(await toIntent({ text: "", image: { kind: "sdk", fetchData: async () => huge } }, signal())).toEqual({
      kind: "local",
      reason: "image_too_large",
    });
    const ok = await toIntent({ text: "co tu jest?", image: { kind: "sdk", fetchData: async () => JPEG } }, signal());
    expect(ok).toEqual({
      kind: "check",
      demo: false,
      request: { input: { type: "image", value: "data:image/jpeg;base64,/9j/4AEC" }, user_message: "co tu jest?" },
    });
  });
});

describe("platform payloads", () => {
  test("Discord /sprawdz: options by name; the attachment id never lands in the text", () => {
    const m = discordSlashToMessage({
      id: "i1",
      data: {
        options: [{ name: "tresc", type: 3, value: "czy to prawda?" }, { name: "obraz", type: 11, value: "999" }],
        resolved: { attachments: { "999": { url: "https://cdn.discordapp.com/x.png", size: 10, content_type: "image/png" } } },
      },
    });
    expect(m).toEqual({ text: "czy to prawda?", image: { kind: "discord", url: "https://cdn.discordapp.com/x.png", size: 10 }, fromSlashCommand: true });
  });

  test("WhatsApp: caption kept, '[Image]' placeholder dropped, stickers ignored, other media unsupported", () => {
    const msg = (raw: unknown, text: string, attachments: unknown[] = []) =>
      ({ raw, text, attachments } as unknown as Parameters<typeof sdkMessageToIncoming>[1]);
    const img = { type: "image", fetchData: async () => JPEG };
    expect(sdkMessageToIncoming("whatsapp", msg({ message: { type: "image", image: { caption: "prawda?" } } }, "prawda?", [img])).text).toBe("prawda?");
    expect(sdkMessageToIncoming("whatsapp", msg({ message: { type: "image", image: {} } }, "[Image]", [img])).text).toBe("");
    expect(sdkMessageToIncoming("whatsapp", msg({ message: { type: "sticker" } }, "[Sticker]")).ignore).toBe(true);
    expect(sdkMessageToIncoming("whatsapp", msg({ message: { type: "video" } }, "[Video]")).unsupported).toBe(true);
    expect(sdkMessageToIncoming("messenger", msg({ message: { sticker_id: 369239263222822 } }, "")).ignore).toBe(true);
    expect(sdkMessageToIncoming("messenger", msg({ message: { text: "hej" } }, "hej")).text).toBe("hej");
  });
});

describe("logging (A11)", () => {
  test("event lines carry no text and no user ids; the SDK logger drops payloads", async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    const uuid = "8e4eea20-b804-4802-8b48-9fd74956f87b";
    await logEvent({ platform: "discord", eventId: "interaction-123", checkId: uuid, startedAt: Date.now() - 5, outcome: "ok" });
    const log = quietLogger();
    log.error("handler failed", { text: "TAJNA TREŚĆ WIADOMOŚCI", userId: "48500100200" }, new TypeError("x"));
    // A platform error body: only numeric code and field codes survive, never its message text.
    log.error("Discord interaction API error", {
      status: 400,
      error: JSON.stringify({ code: 50035, message: "TAJNA echo", errors: { "48500100200": { _errors: [{ code: "BASE_TYPE_MAX_LENGTH", message: "TAJNA" }] } } }),
    });
    // A check_id that isn't a UUID is upstream text: not logged.
    await logEvent({ platform: "discord", eventId: "e2", checkId: "TAJNA <script>", startedAt: Date.now(), outcome: "ok" });
    log.info("message", { text: "TAJNA TREŚĆ WIADOMOŚCI" });
    setLogSink((l) => console.log(l));
    const all = lines.join("\n");
    expect(all).not.toContain("TAJNA");
    expect(all).not.toContain("48500100200");
    expect(all).not.toContain("interaction-123");
    expect(JSON.parse(lines[0])).toMatchObject({ msg: "bot_event", platform: "discord", check_id: uuid, outcome: "ok" });
    expect(JSON.parse(lines[2])).toMatchObject({ status: 400, platform_error: { code: 50035 } });
    expect(JSON.parse(lines[3]).check_id).toBeNull();
    expect(JSON.parse(lines[1])).toMatchObject({ text: "handler failed", error_name: "TypeError" });
    expect(lines).toHaveLength(4);
  });
});

describe("Discord /demo", () => {
  test("a listed scenario becomes demo:<scenario>; anything else becomes an empty command", async () => {
    const { discordDemoToMessage } = await import("../src/platforms.js");
    const { DEMO_SCENARIOS } = await import("../src/demo.js");
    const { MOCK_SCENARIOS } = await import("../../../packages/core/src/mock/fixtures.js");
    const opt = (value: unknown) => ({ data: { options: [{ name: "scenariusz", type: 3, value }] } });
    expect(discordDemoToMessage(opt("mixed"))).toEqual({ text: "demo:mixed", fromSlashCommand: true });
    expect(discordDemoToMessage(opt("rm -rf"))).toEqual({ text: "", fromSlashCommand: true });
    // Every dropdown choice is a real API scenario, and Discord's 25-choice limit holds.
    for (const s of DEMO_SCENARIOS) expect((MOCK_SCENARIOS as readonly string[]).includes(s.value)).toBe(true);
    expect(DEMO_SCENARIOS.length).toBeLessThanOrEqual(25);
    for (const s of DEMO_SCENARIOS) expect(s.label.length).toBeLessThanOrEqual(100);
  });
});
