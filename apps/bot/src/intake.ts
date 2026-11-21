/**
 * Intake: a platform message → what the user wants (messaging-bot.md, "Message flow", step 4).
 *   - a check request (`text`, `url`, or `image` as a `data:` URL),
 *   - a command (`pomoc`, `usuń dane`: exact match only),
 *   - a local reply (unsupported file, image too big, empty /sprawdz), never sent to the API,
 *   - or nothing at all (Messenger stickers and the thumbs-up).
 * Platform adapters (platforms.ts) first turn their payload into the neutral `IncomingMessage`.
 */
import type { CheckRequest } from "@prawdowid/core/types";
import { LIMITS } from "./config.ts";
import { fetchDiscordImage, fetchSdkImage, type ImageResult } from "./image.ts";

export type ImageSource =
  /** Discord `obraz` option, from `resolved.attachments`. */
  | { kind: "discord"; url: string; size?: number }
  /** WhatsApp / Messenger attachment with the SDK's authenticated download. */
  | { kind: "sdk"; size?: number; fetchData?: () => Promise<ArrayBuffer | Uint8Array> };

export interface IncomingMessage {
  /** What the user typed (a WhatsApp caption, the Discord `tresc` option, a Messenger text). */
  text: string;
  image?: ImageSource;
  /** A file, video, audio, location… that we don't check. */
  unsupported?: boolean;
  /** Stickers and the Messenger thumbs-up: no reply at all. */
  ignore?: boolean;
  /** A Discord slash command, where an empty /sprawdz must get a hint (not the help text). */
  fromSlashCommand?: boolean;
}

export type LocalReason = "unsupported_file" | "image_too_large" | "not_an_image" | "image_fetch_failed" | "empty";

export type Intent =
  | { kind: "check"; request: CheckRequest; demo: boolean }
  | { kind: "help" }
  | { kind: "delete_data" }
  | { kind: "local"; reason: LocalReason }
  | { kind: "ignore" };

const HELP = new Set(["pomoc", "help", "start", "/pomoc", "/start", "?"]);
const DELETE = new Set(["usuń dane", "usun dane"]);
const URL_RE = /https?:\/\/[^\s<>"]+/gi;
/** A message is "mostly one link" when the rest is a short question about it. */
const MAX_TEXT_BESIDE_URL = 300;

/** The same rule the API uses: trimmed, case-insensitive `demo:` prefix. */
export function isDemoText(text: string): boolean {
  return /^demo:/i.test(text.trim());
}

function imageFailure(r: Exclude<ImageResult, { ok: true }>): LocalReason {
  if (r.reason === "too_large") return "image_too_large";
  if (r.reason === "not_an_image") return "not_an_image";
  return "image_fetch_failed";
}

export async function toIntent(msg: IncomingMessage, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Intent> {
  if (msg.ignore) return { kind: "ignore" };
  const text = msg.text.replace(/^(\s*<@[!&]?\d+>\s*)+/, "").trim();
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  if (!msg.image && !msg.fromSlashCommand) {
    if (HELP.has(lower)) return { kind: "help" };
    if (DELETE.has(lower)) return { kind: "delete_data" };
  }

  if (msg.image) {
    const r = msg.image.kind === "discord"
      ? await fetchDiscordImage(msg.image, signal, fetchImpl)
      : await fetchSdkImage(msg.image, signal);
    if (!r.ok) return { kind: "local", reason: imageFailure(r) };
    return {
      kind: "check",
      demo: false,
      request: {
        input: { type: "image", value: r.dataUrl },
        ...(text ? { user_message: text.slice(0, LIMITS.maxUserMessageChars) } : {}),
      },
    };
  }
  if (msg.unsupported) return { kind: "local", reason: "unsupported_file" };
  if (!text) return msg.fromSlashCommand ? { kind: "local", reason: "empty" } : { kind: "help" };

  const demo = isDemoText(text);
  const urls = text.match(URL_RE) ?? [];
  if (!demo && urls.length === 1) {
    const rest = text.replace(urls[0], "").trim();
    if (rest.length <= MAX_TEXT_BESIDE_URL) {
      return {
        kind: "check",
        demo: false,
        request: { input: { type: "url", value: urls[0] }, ...(rest ? { user_message: rest } : {}) },
      };
    }
  }
  return { kind: "check", demo, request: { input: { type: "text", value: text.slice(0, LIMITS.maxTextChars) } } };
}
