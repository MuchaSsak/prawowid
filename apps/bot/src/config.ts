/**
 * Bot configuration. Secrets come from env; everything else is a code default
 * (decisions/003-config-in-code.md). A platform is enabled only when all of its env vars are set,
 * so the bot runs with any subset of Discord / WhatsApp / Messenger.
 *
 * There is deliberately no "mock" switch here: the API decides mock vs live (PRAWDOWID_MODE, or
 * MOCK_CLIENTS=bot for this bot's key), so the web app and the bot always agree (decision 007).
 */

export type Platform = "discord" | "whatsapp" | "messenger";
/** Where a reply is rendered. `console` is the terminal channel (src/console.ts). */
export type Surface = Platform | "console";

export const PLATFORMS: Platform[] = ["discord", "whatsapp", "messenger"];

/** Env vars each Chat SDK adapter reads by itself. */
export const PLATFORM_ENV: Record<Platform, string[]> = {
  discord: ["DISCORD_BOT_TOKEN", "DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID"],
  whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"],
  messenger: ["FACEBOOK_APP_SECRET", "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_VERIFY_TOKEN"],
};

/** Longest single message we send (the platform limit minus a margin). */
export const MAX_REPLY_CHARS: Record<Surface, number> = {
  discord: 1900, // hard limit 2000
  whatsapp: 3900, // 4096
  messenger: 1900, // 2000
  console: 4000,
};

export const LIMITS = {
  /** One deadline per request, shared by the image download and the API call (messaging-bot.md, step 2). */
  requestDeadlineMs: 45_000,
  /** The API's own deadline is 30 s; api-reference asks clients for at least 35 s. */
  apiTimeoutMs: 40_000,
  maxImageBytes: 5 * 1024 * 1024,
  maxUserMessageChars: 2000,
  maxTextChars: 50_000,
  /** How long the API's mode (for the `demo:` gate) is trusted before asking /health again. */
  modeCacheMs: 5 * 60_000,
  /** Chat SDK dedupe window for platform retries. */
  dedupeTtlMs: 10 * 60_000,
  maxCitationsPerClaim: 3,
} as const;

export const DEFAULT_API_URL = "https://prawowid.mateusz.deno.net";

export interface BotConfig {
  /** Prawdomat API base URL, without a trailing slash. */
  apiUrl: string;
  /** `X-Client-Key` (must be in the API's CLIENT_KEYS). Optional: without it the bot shares one IP limit. */
  clientKey: string | undefined;
  /** HMAC key for user pseudonyms. Required in production (see pseudonym.ts). */
  idSecret: string | undefined;
  /** The web app link shown in every reply's footer. */
  webUrl: string | null;
  /** Data controller and contact for the privacy notice (/pomoc). Blocks the public invite until set. */
  controller: string | null;
  enabled: Platform[];
  port: number;
}

export interface Env {
  get(key: string): string | undefined;
}

export function loadConfig(env: Env): BotConfig {
  return {
    apiUrl: (env.get("PRAWDOWID_API_URL") || DEFAULT_API_URL).replace(/\/+$/, ""),
    clientKey: env.get("PRAWDOWID_CLIENT_KEY") || undefined,
    idSecret: env.get("BOT_ID_SECRET") || undefined,
    webUrl: env.get("PRAWDOWID_WEB_URL") || null,
    controller: env.get("BOT_PRIVACY_CONTACT") || null,
    enabled: PLATFORMS.filter((p) => PLATFORM_ENV[p].every((k) => Boolean(env.get(k)))),
    port: Number(env.get("BOT_PORT") || 8788),
  };
}
