/**
 * One capped image fetch for every platform (messaging-bot.md, "Message flow", step 4):
 *   - Discord: our own download, only from Discord's CDN hosts, no redirects, a Content-Length
 *     check, and a streamed read that aborts at 5 MB, all under the request deadline.
 *   - Messenger: the SDK's `fetchData` (it handles Meta's auth and domain allowlist and
 *     stops at 25 MB), so the size is re-checked after the download.
 *   - Every platform: the type is verified from the first bytes, never from the declared MIME type.
 */
import { LIMITS } from "./config.js";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export type ImageResult =
  | { ok: true; dataUrl: string; mime: ImageMime; bytes: number }
  | { ok: false; reason: "too_large" | "not_an_image" | "fetch_failed" | "host_not_allowed" };

const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/** JPEG FF D8 FF · PNG 89 50 4E 47 0D 0A 1A 0A · WebP "RIFF" ???? "WEBP". */
export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function finish(bytes: Uint8Array): ImageResult {
  if (bytes.byteLength > LIMITS.maxImageBytes) return { ok: false, reason: "too_large" };
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, reason: "not_an_image" };
  return { ok: true, mime, bytes: bytes.byteLength, dataUrl: `data:${mime};base64,${toBase64(bytes)}` };
}

/** Reads a body stream, aborting as soon as it passes `max` bytes. */
async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | "too_large"> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Discord attachment (from `resolved.attachments`): declared size first, then a capped download. */
export async function fetchDiscordImage(
  att: { url: string; size?: number },
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageResult> {
  if (att.size !== undefined && att.size > LIMITS.maxImageBytes) return { ok: false, reason: "too_large" };
  let url: URL;
  try {
    url = new URL(att.url);
  } catch {
    return { ok: false, reason: "host_not_allowed" };
  }
  if (url.protocol !== "https:" || !DISCORD_CDN_HOSTS.has(url.hostname)) return { ok: false, reason: "host_not_allowed" };
  try {
    const res = await fetchImpl(url, { redirect: "manual", signal });
    if (res.status !== 200 || !res.body) return { ok: false, reason: "fetch_failed" };
    const declared = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > LIMITS.maxImageBytes) {
      await res.body.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    const bytes = await readCapped(res.body, LIMITS.maxImageBytes);
    return bytes === "too_large" ? { ok: false, reason: "too_large" } : finish(bytes);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

/** Messenger: the SDK's authenticated `fetchData`, raced against the request deadline. */
export async function fetchSdkImage(
  att: { size?: number; fetchData?: () => Promise<ArrayBuffer | Uint8Array> },
  signal: AbortSignal,
): Promise<ImageResult> {
  if (att.size !== undefined && att.size > LIMITS.maxImageBytes) return { ok: false, reason: "too_large" };
  if (!att.fetchData) return { ok: false, reason: "fetch_failed" };
  try {
    const aborted = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const raw = await Promise.race([att.fetchData(), aborted]);
    return finish(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}
