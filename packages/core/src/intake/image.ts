/**
 * Image → text through one vision-model call (decisions/002). Metadata (EXIF/XMP/IPTC, PNG text
 * chunks) is stripped locally before sending; the raw image is never stored.
 */
import { z } from "zod";
import { LIMITS } from "../config.ts";
import { chatJson, type LlmUsage } from "../llm/openrouter.ts";
import { IMAGE_EXTRACTION_ID, imageExtractionSystem } from "../prompts/media-extraction.v1.ts";
import { IntakeError } from "./url.ts";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) throw new IntakeError("invalid_url", "Nieprawidłowy obraz.");
  const mime = m[1].toLowerCase();
  if (!ALLOWED.includes(mime)) throw new IntakeError("unsupported", "Obsługujemy obrazy JPG, PNG i WebP.");
  const bin = atob(m[2]);
  if (bin.length > LIMITS.maxImageBytes) throw new IntakeError("too_large", "Obraz jest za duży (maks. 5 MB).");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

/** Drop JPEG APP1 (EXIF/XMP) and APP13 (IPTC) segments, and PNG eXIf/tEXt/iTXt/zTXt chunks. */
export function stripMetadata(mime: string, b: Uint8Array): Uint8Array {
  if (mime === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8) {
    const out: number[] = [0xff, 0xd8];
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda) break; // start of scan: copy the rest verbatim
      const len = (b[i + 2] << 8) | b[i + 3];
      const drop = marker === 0xe1 || marker === 0xed;
      if (!drop) for (let k = i; k < i + 2 + len; k++) out.push(b[k]);
      i += 2 + len;
    }
    const rest = b.subarray(i);
    const res = new Uint8Array(out.length + rest.length);
    res.set(out, 0);
    res.set(rest, out.length);
    return res;
  }
  if (mime === "image/png" && b[0] === 0x89 && b[1] === 0x50) {
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let i = 8;
    while (i + 12 <= b.length) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      const end = i + 12 + len;
      if (!["eXIf", "tEXt", "iTXt", "zTXt"].includes(type)) parts.push(b.subarray(i, end));
      i = end;
    }
    const total = parts.reduce((s, p) => s + p.length, 0);
    const res = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      res.set(p, off);
      off += p.length;
    }
    return res;
  }
  return b; // webp: sent as is (no EXIF parsing yet)
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const ImageExtraction = z.strictObject({
  ocr_text: z.string(),
  content_kind: z.enum(["social_post", "article", "chart", "document", "meme", "photo", "other"]),
  visible_source: z.string().nullable(),
  visible_dates: z.array(z.string()),
  description: z.string(),
  legibility: z.enum(["good", "partial", "poor"]),
  injection_signals: z.array(z.string()),
});
export type ImageExtraction = z.infer<typeof ImageExtraction>;

export async function extractImage(
  dataUrl: string,
  opts: { apiKey?: string; model: string; signal?: AbortSignal },
): Promise<{ data: ImageExtraction; usage: LlmUsage; prompt: string }> {
  const { mime, bytes } = parseDataUrl(dataUrl);
  const clean = stripMetadata(mime, bytes);
  const { data, usage } = await chatJson({
    apiKey: opts.apiKey,
    model: opts.model,
    system: imageExtractionSystem("Polish"),
    user: [
      { type: "text", text: "Transcribe and describe this image." },
      { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(clean)}` } },
    ],
    schemaName: "image_extraction",
    schema: ImageExtraction,
    timeoutMs: LIMITS.imageTimeoutMs,
    maxTokens: 2000,
    signal: opts.signal,
  });
  return { data, usage, prompt: IMAGE_EXTRACTION_ID };
}
