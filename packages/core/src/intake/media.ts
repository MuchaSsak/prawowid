/**
 * Shape checks for uploaded media (image, video, audio) sent as `data:<mime>;base64,…` URLs.
 * Cheap: reads only the header and the base64 length, never decodes. Used by the live pipeline
 * and by the API's mock path, so both reject the same inputs with the same message.
 * Wiki: architecture/api-reference.md, architecture/multimodal-media.md
 */
import { LIMITS } from "../config.ts";
import type { InputType } from "../types.ts";

export type MediaType = Extract<InputType, "image" | "video" | "audio">;

export const MEDIA_MIME: Record<MediaType, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/mpeg"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm"],
};

const LABEL: Record<MediaType, { noun: string; big: string; formats: string; max: number }> = {
  image: { noun: "Obraz", big: "za duży", formats: "JPG, PNG i WebP", max: LIMITS.maxImageBytes },
  video: { noun: "Nagranie wideo", big: "za duże", formats: "MP4, WebM, MOV i MPEG", max: LIMITS.maxMediaBytes },
  audio: { noun: "Nagranie audio", big: "za duże", formats: "MP3, WAV, M4A, AAC, OGG i WebM", max: LIMITS.maxMediaBytes },
};

export function isMediaType(t: unknown): t is MediaType {
  return t === "image" || t === "video" || t === "audio";
}

/** Returns a Polish rejection message, or null when the data URL is acceptable. */
export function mediaInputError(type: MediaType, value: string): string | null {
  const l = LABEL[type];
  const m = value.match(/^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,/);
  if (!m) return `${l.noun}: oczekujemy pliku jako data URL (data:<typ>;base64,…).`;
  if (!MEDIA_MIME[type].includes(m[1].toLowerCase())) return `${l.noun}: obsługujemy formaty ${l.formats}.`;
  // Live image intake (image.ts parseDataUrl) takes no MIME parameters; keep mock and live alike.
  if (type === "image" && m[0] !== `data:${m[1]};base64,`) return `${l.noun}: nieprawidłowy nagłówek pliku.`;
  const payload = value.slice(m[0].length);
  if (!payload) return `${l.noun}: plik jest pusty.`;
  // Padding is optional (atob accepts both forms); a padded payload must be whole 4-char groups,
  // and 1 leftover character can never encode a byte.
  const pad = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const chars = payload.length - pad;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || (pad && payload.length % 4 !== 0) || chars % 4 === 1) {
    return `${l.noun}: plik jest uszkodzony (nieprawidłowe dane).`;
  }
  const bytes = Math.floor((chars * 3) / 4); // decoded size
  if (bytes > l.max) return `${l.noun} jest ${l.big} (maks. ${Math.round(l.max / 1024 / 1024)} MB).`;
  return null;
}
