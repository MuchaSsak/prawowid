/**
 * Chat SDK wiring (messaging-bot.md, "Components" → Chat SDK):
 *   - one `Chat` instance per platform, created and cached on that platform's first webhook, with
 *     the adapter loaded by a dynamic `import()`, so a Discord cold start never loads Meta's code;
 *   - the same handlers for every instance (registerHandlers), all calling `converse`;
 *   - `concurrent`: every message is its own check (in `queue` mode the SDK would skip messages,
 *     and a skipped Discord interaction would hang on "thinking…");
 *   - Discord replies are ephemeral with embeds suppressed; slash commands only (no Gateway);
 *   - a payload-free logger; memory state until Redis lands in M1b.
 */
import type { Adapter, Chat, Message, SlashCommandEvent, Thread } from "chat";
import type { WhatsAppRawMessage } from "@chat-adapter/whatsapp";
import type { MessengerRawMessage } from "@chat-adapter/messenger";
import { type BotConfig, LIMITS, type Platform } from "./config.ts";
import type { PrawdowidClient } from "./client.ts";
import { converse, type Turn } from "./conversation.ts";
import { demoText } from "./demo.ts";
import type { IncomingMessage } from "./intake.ts";
import { logEvent, quietLogger } from "./log.ts";

export interface PlatformDeps {
  config: BotConfig;
  client: PrawdowidClient;
  idSecret: string;
}

/** Discord MessageFlags: EPHEMERAL (64) | SUPPRESS_EMBEDS (4). */
const DISCORD_FLAGS = 64 | 4;

async function createAdapter(platform: Platform): Promise<Adapter> {
  const logger = quietLogger(platform);
  switch (platform) {
    case "discord": {
      const { createDiscordAdapter } = await import("@chat-adapter/discord");
      // The adapter's type only names Ephemeral; Discord accepts any message-flag bitfield here, and
      // the follow-up PATCH ORs the same flags in (prototype findings).
      return createDiscordAdapter({ logger, interactionFlags: () => DISCORD_FLAGS as 64 });
    }
    case "whatsapp": {
      const { createWhatsAppAdapter } = await import("@chat-adapter/whatsapp");
      return createWhatsAppAdapter({ logger });
    }
    case "messenger": {
      const { createMessengerAdapter } = await import("@chat-adapter/messenger");
      return createMessengerAdapter({ logger });
    }
  }
}

// ---- platform payload → IncomingMessage -------------------------------------------------------

type DiscordOption = { name: string; type: number; value?: unknown; options?: DiscordOption[] };
type DiscordInteraction = {
  id?: string;
  data?: {
    options?: DiscordOption[];
    resolved?: { attachments?: Record<string, { url?: string; size?: number; content_type?: string }> };
  };
};

/**
 * Discord /sprawdz: options read by name from the raw interaction (`tresc` string, `obraz`
 * attachment). Never `event.text`: the SDK flattens every option into it, attachment id included.
 */
/** Discord /demo: the `scenariusz` choice becomes the text `demo:<scenario>` (same gate as typing it). */
export function discordDemoToMessage(raw: unknown): IncomingMessage {
  const opts = (raw as DiscordInteraction).data?.options ?? [];
  const text = demoText(opts.find((o) => o.name === "scenariusz" && o.type === 3)?.value);
  return { text: text ?? "", fromSlashCommand: true };
}

export function discordSlashToMessage(raw: unknown): IncomingMessage {
  const i = raw as DiscordInteraction;
  const opts = i.data?.options ?? [];
  const tresc = opts.find((o) => o.name === "tresc" && o.type === 3)?.value;
  const obrazId = opts.find((o) => o.name === "obraz" && o.type === 11)?.value;
  const att = typeof obrazId === "string" ? i.data?.resolved?.attachments?.[obrazId] : undefined;
  return {
    text: typeof tresc === "string" ? tresc : "",
    image: att?.url ? { kind: "discord", url: att.url, size: att.size } : undefined,
    fromSlashCommand: true,
  };
}

/** Messenger's sticker / thumbs-up fields, not in the adapter's types. */
type MessengerStickerFields = { message?: { sticker_id?: number; attachments?: { payload?: { sticker_id?: number } }[] } };

/** WhatsApp / Messenger message → IncomingMessage. */
export function sdkMessageToIncoming(platform: Platform, message: Message): IncomingMessage {
  const image = message.attachments.find((a) => a.type === "image");
  const imageSource = image
    ? { kind: "sdk" as const, size: image.size, fetchData: image.fetchData as (() => Promise<ArrayBuffer | Uint8Array>) | undefined }
    : undefined;

  if (platform === "whatsapp") {
    // The adapter turns media into placeholder text ("[Image]", "[Sticker]"), so read the raw type.
    const inbound = (message.raw as WhatsAppRawMessage | undefined)?.message;
    const type = inbound?.type;
    if (type === "sticker" || type === "reaction") return { text: "", ignore: true };
    if (type === "image") return { text: inbound?.image?.caption ?? "", image: imageSource };
    if (type !== "text") return { text: "", unsupported: true };
    return { text: message.text };
  }

  // Messenger: stickers and the thumbs-up are attachments with a sticker_id.
  const raw = message.raw as (MessengerRawMessage & MessengerStickerFields) | undefined;
  if (raw?.message?.sticker_id !== undefined || raw?.message?.attachments?.some((a) => a.payload?.sticker_id !== undefined)) {
    return { text: "", ignore: true };
  }
  if (imageSource) return { text: message.text, image: imageSource };
  if (message.attachments.length > 0) return { text: message.text, unsupported: !message.text };
  return { text: message.text };
}

// ---- handlers ----------------------------------------------------------------------------------

async function respond(
  deps: PlatformDeps,
  platform: Platform,
  eventId: string,
  turn: Turn,
  post: (text: string) => Promise<unknown>,
) {
  const startedAt = Date.now();
  const reply = await converse(turn, deps);
  if (reply.text !== null) {
    try {
      await post(reply.text);
    } catch {
      // Posting itself failed (platform API down): nothing more we can send. Logged, never silent.
      await logEvent({ platform, eventId, checkId: reply.checkId, startedAt, outcome: "technical_error" });
      return;
    }
  }
  await logEvent({ platform, eventId, checkId: reply.checkId, startedAt, outcome: reply.outcome });
}

export function registerHandlers(chat: Chat, platform: Platform, deps: PlatformDeps) {
  // WhatsApp and Messenger: every message is a direct message.
  chat.onDirectMessage(async (thread: Thread, message: Message) => {
    if (message.author.isMe || message.author.isBot === true) return;
    if (platform === "discord") return; // Discord DMs need the Gateway: out of scope (decision 007)
    const incoming = sdkMessageToIncoming(platform, message);
    if (!incoming.ignore) await thread.startTyping().catch(() => {});
    await respond(deps, platform, message.id, { surface: platform, userId: message.author.userId, message: incoming }, (t) =>
      thread.post({ raw: t }));
  });

  const slash = (command: Turn["command"], parse = discordSlashToMessage) => async (event: SlashCommandEvent) => {
    const raw = event.raw as DiscordInteraction;
    const incoming = command ? { text: "", fromSlashCommand: true } : parse(raw);
    await respond(
      deps,
      platform,
      raw.id ?? `${event.user.userId}:${Date.now()}`,
      { surface: platform, userId: event.user.userId, message: incoming, command },
      (t) => event.channel.post({ raw: t }),
    );
  };
  chat.onSlashCommand("/sprawdz", slash(undefined));
  chat.onSlashCommand("/demo", slash(undefined, discordDemoToMessage));
  chat.onSlashCommand("/pomoc", slash("help"));
  chat.onSlashCommand("/usun-dane", slash("delete_data"));
}

const instances = new Map<Platform, Promise<Chat>>();

/** The platform's Chat instance, created on its first webhook. Never add an adapter to it later. */
export function getChat(platform: Platform, deps: PlatformDeps): Promise<Chat> {
  let p = instances.get(platform);
  if (!p) {
    p = (async () => {
      const [{ Chat }, { createMemoryState }, adapter] = await Promise.all([
        import("chat"),
        import("@chat-adapter/state-memory"),
        createAdapter(platform),
      ]);
      const chat = new Chat({
        userName: "prawdowid",
        adapters: { [platform]: adapter },
        state: createMemoryState(),
        concurrency: "concurrent",
        dedupeTtlMs: LIMITS.dedupeTtlMs,
        logger: quietLogger("chat"),
      });
      registerHandlers(chat, platform, deps);
      return chat;
    })();
    p.catch(() => instances.delete(platform));
    instances.set(platform, p);
  }
  return p;
}
