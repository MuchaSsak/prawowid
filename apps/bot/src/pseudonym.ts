/**
 * User pseudonyms (messaging-bot.md, "Security and privacy"):
 * `HMAC-SHA256(BOT_ID_SECRET, "<platform>:<userId>")`, used as `X-End-User`, `session_id` and
 * (from M1b) the quota key. Without the secret it can't be recomputed from a phone number or a
 * public Discord id, so the session id also works as the capability for "usuń dane".
 * It is a stable pseudonym, not anonymous data: GDPR still applies.
 */
import type { Surface } from "./config.ts";

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function pseudonym(secret: string, platform: Surface, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${platform}:${userId}`)));
}

/** Short one-way hash for log lines (event ids). Not reversible, not linkable to the pseudonym. */
export async function shortHash(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(`log:${text}`))).slice(0, 16);
}

/**
 * The secret to use. Production (a platform webhook) refuses to run without BOT_ID_SECRET; the
 * console channel gets a random per-process secret, so its pseudonyms never repeat across runs.
 */
export function resolveIdSecret(configured: string | undefined, allowEphemeral: boolean): string {
  if (configured) return configured;
  if (!allowEphemeral) throw new Error("BOT_ID_SECRET is not set");
  return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
