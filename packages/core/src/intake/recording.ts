/**
 * Video or audio → timestamped transcript through one model call (architecture/multimodal-media.md).
 * Audio goes to the EU model (Voxtral) when its format allows; anything else, and every video, goes
 * to the video model (Gemini, non-EEA, disclosed by the caller). The recording is never stored.
 */
import { z } from "zod";
import { type Config, LIMITS } from "../config.ts";
import { chatJson, type ContentPart, type LlmUsage } from "../llm/openrouter.ts";
import { RECORDING_TRANSCRIPTION_ID, recordingTranscriptionSystem } from "../prompts/media-extraction.v1.ts";
import type { Material } from "../pipeline/extract.ts";
import { IntakeError } from "./url.ts";

/** Formats Voxtral decodes (probed 2026-11-21: webm and m4a fail with "valid mp3 or wav"). */
const VOXTRAL_FORMAT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
};
/** input_audio.format for the other audio types (Gemini decodes all of them). */
const OTHER_FORMAT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

export const RecordingTranscript = z.strictObject({
  segments: z.array(z.strictObject({ start: z.string(), speaker: z.string(), text: z.string() })),
  on_screen_text: z.array(z.strictObject({ at: z.string(), text: z.string() })),
  visual_summary: z.string(),
  language: z.string(),
  audibility: z.enum(["good", "partial", "poor"]),
  injection_signals: z.array(z.string()),
});
export type RecordingTranscript = z.infer<typeof RecordingTranscript>;

export interface RecordingRoute {
  model: string;
  part: ContentPart;
  /** True when the model runs outside the EEA (the caller adds the disclosure). */
  nonEea: boolean;
}

/** Picks the model and content part. The data URL was already validated (intake/media.ts). */
export function recordingRoute(kind: "video" | "audio", dataUrl: string, models: Config["models"]): RecordingRoute {
  const m = dataUrl.match(/^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,/);
  if (!m) throw new IntakeError("invalid_url", "Nieprawidłowe nagranie.");
  const mime = m[1].toLowerCase();
  const data = dataUrl.slice(m[0].length);
  const isEu = (model: string) => model.startsWith("mistralai/");
  if (kind === "video") {
    // Gemini wants a plain `data:<mime>;base64,` header; drop codec parameters.
    return { model: models.video_transcription, part: { type: "video_url", video_url: { url: `data:${mime};base64,${data}` } }, nonEea: !isEu(models.video_transcription) };
  }
  const audioModel = models.audio_transcription;
  const voxtralOk = VOXTRAL_FORMAT[mime];
  // A Mistral audio model cannot read webm/m4a/aac: send those to the video model instead.
  const model = isEu(audioModel) && !voxtralOk ? models.video_transcription : audioModel;
  const format = voxtralOk ?? OTHER_FORMAT[mime] ?? mime.split("/")[1];
  return { model, part: { type: "input_audio", input_audio: { data, format } }, nonEea: !isEu(model) };
}

/** "1:05", "01:05", "00:01:05", "65" → "01:05" (or "1:01:05" past an hour); unknown → "00:00". */
export function normalizeStamp(raw: string): string {
  const parts = raw.trim().split(":").map((p) => Number.parseInt(p, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return "00:00";
  const secs = parts.reduce((s, n) => s * 60 + n, 0);
  const h = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}

/**
 * Transcript → material. Consecutive segments are joined per speaker turn so a claim spanning two
 * sentences stays in one item; provenance is `<kind>@mm:ss` of the turn's first segment.
 */
export function transcriptToMaterial(kind: "video" | "audio", t: RecordingTranscript, maxChars = LIMITS.maxMaterialChars): { material: Material[]; truncated: boolean } {
  const items: Material[] = [];
  let lastSpeaker: string | null = null;
  for (const s of t.segments) {
    const text = s.text.trim();
    if (!text) continue;
    const prev = items[items.length - 1];
    if (prev && s.speaker === lastSpeaker && prev.text.length + text.length < 600) {
      prev.text = `${prev.text} ${text}`;
    } else {
      items.push({ provenance: `${kind}@${normalizeStamp(s.start)}`, text });
    }
    lastSpeaker = s.speaker;
  }
  for (const o of t.on_screen_text) {
    const text = o.text.trim();
    if (text) items.push({ provenance: `${kind}@${normalizeStamp(o.at)}`, text: `[Tekst na ekranie] ${text}` });
  }
  let used = 0;
  const kept: Material[] = [];
  for (const it of items) {
    if (used + it.text.length > maxChars) return { material: kept, truncated: true };
    used += it.text.length;
    kept.push(it);
  }
  return { material: kept, truncated: false };
}

export async function transcribeRecording(
  kind: "video" | "audio",
  dataUrl: string,
  opts: { apiKey?: string; models: Config["models"]; signal?: AbortSignal },
): Promise<{ data: RecordingTranscript; usage: LlmUsage; prompt: string; nonEea: boolean }> {
  const route = recordingRoute(kind, dataUrl, opts.models);
  const { data, usage } = await chatJson({
    apiKey: opts.apiKey,
    model: route.model,
    system: recordingTranscriptionSystem("Polish", kind),
    user: [{ type: "text", text: `Transcribe this ${kind} recording.` }, route.part],
    schemaName: `${kind}_transcription`,
    schema: RecordingTranscript,
    timeoutMs: LIMITS.recordingTimeoutMs,
    maxTokens: 6000,
    signal: opts.signal,
  });
  return { data, usage, prompt: RECORDING_TRANSCRIPTION_ID, nonEea: route.nonEea };
}
