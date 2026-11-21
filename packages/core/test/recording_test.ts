/**
 * Video and audio intake: model routing per format, transcript → timestamped material, and the
 * failure paths (system states, never verdicts). Synthetic data only (rule 16).
 */
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { CheckResponseSchema, loadConfig, runCheck } from "../src/mod.ts";
import { normalizeStamp, recordingRoute, type RecordingTranscript, transcriptToMaterial } from "../src/intake/recording.ts";
import { deps, extraction, stubFetch, T } from "./harness.ts";

const CLAIM = "Most w Przykładowie zamknięto na stałe w 2025 roku.";
const valid = (r: unknown) => assert(CheckResponseSchema.safeParse(r).success, "response must match contract v1");
const MP3 = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjMuMTAw";
const WEBM = "data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC";
const MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==";
const models = loadConfig({ get: () => undefined }).models;

const transcript = (over: Partial<RecordingTranscript> = {}): RecordingTranscript => ({
  segments: [{ start: "0:05", speaker: "Mówca 1", text: CLAIM }],
  on_screen_text: [],
  visual_summary: "",
  language: "pl",
  audibility: "good",
  injection_signals: [],
  ...over,
});

Deno.test("routing: mp3/wav/ogg audio → Voxtral (EU); webm audio and all video → Gemini (non-EEA)", () => {
  const mp3 = recordingRoute("audio", MP3, models);
  assertEquals(mp3.model, models.audio_transcription);
  assertEquals(mp3.nonEea, false);
  assertEquals((mp3.part as { input_audio: { format: string } }).input_audio.format, "mp3");
  const webm = recordingRoute("audio", WEBM, models);
  assertEquals(webm.model, models.video_transcription);
  assertEquals(webm.nonEea, true);
  assertEquals((webm.part as { input_audio: { format: string; data: string } }).input_audio.format, "webm");
  assert(!(webm.part as { input_audio: { data: string } }).input_audio.data.startsWith("data:"), "audio is bare base64");
  const vid = recordingRoute("video", MP4, models);
  assertEquals(vid.model, models.video_transcription);
  assert((vid.part as { video_url: { url: string } }).video_url.url.startsWith("data:video/mp4;base64,"));
});

Deno.test("timestamps are normalized to mm:ss", () => {
  assertEquals(normalizeStamp("0:05"), "00:05");
  assertEquals(normalizeStamp("65"), "01:05");
  assertEquals(normalizeStamp("00:01:15"), "01:15");
  assertEquals(normalizeStamp("1:02:03"), "1:02:03");
  assertEquals(normalizeStamp("ok"), "00:00");
});

Deno.test("transcript → material: one item per speaker turn, on-screen text marked, capped", () => {
  const t = transcript({
    segments: [
      { start: "0:01", speaker: "Mówca 1", text: "Pierwsze zdanie." },
      { start: "0:03", speaker: "Mówca 1", text: "Drugie zdanie." },
      { start: "0:09", speaker: "Mówca 2", text: "Odpowiedź." },
    ],
    on_screen_text: [{ at: "0:02", text: "PILNE: test" }],
  });
  const { material, truncated } = transcriptToMaterial("video", t);
  assertEquals(material, [
    { provenance: "video@00:01", text: "Pierwsze zdanie. Drugie zdanie." },
    { provenance: "video@00:09", text: "Odpowiedź." },
    { provenance: "video@00:02", text: "[Tekst na ekranie] PILNE: test" },
  ]);
  assertEquals(truncated, false);
  assertEquals(transcriptToMaterial("video", t, 20).truncated, true);
});

Deno.test({ ...T, name: "audio (mp3) → transcript becomes material with audio@mm:ss; EU model, no non-EEA note", async fn() {
  const s = stubFetch(
    {
      recording: () => transcript(),
      extraction: (inp) => (assertEquals(inp.material[0].provenance, "audio@00:05"), extraction([{ text: CLAIM }])),
    },
    { googleFactCheck: () => ({}) },
  );
  try {
    const r = await runCheck({ input: { type: "audio", value: MP3 } }, deps());
    valid(r);
    assertEquals(r.status, "ok");
    const first = s.calls.find((c) => c.url.hostname === "openrouter.ai")!.body as { model: string };
    assertEquals(first.model, models.audio_transcription);
    assert(r.limitations.some((l) => l.includes("Nie oceniamy, czy nagranie jest autentyczne")));
    assert(!r.limitations.some((l) => l.includes("poza Europejskim")));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "video → Gemini; on-screen text is material; non-EEA processing is disclosed", async fn() {
  const s = stubFetch(
    {
      recording: (parts) => {
        assert(JSON.stringify(parts).includes('"video_url"'));
        return transcript({ segments: [], on_screen_text: [{ at: "0:10", text: CLAIM }], visual_summary: "Plansza z napisem." });
      },
      extraction: (inp) => (assertEquals(inp.material[0].provenance, "video@00:10"), extraction([{ text: CLAIM }])),
    },
    { googleFactCheck: () => ({}) },
  );
  try {
    const r = await runCheck({ input: { type: "video", value: MP4 } }, deps());
    valid(r);
    assertEquals(r.input.description, "Plansza z napisem.");
    assert(r.limitations.some((l) => l.includes("poza Europejskim")));
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "silent recording without a message → needs_clarification, no extraction call", async fn() {
  const s = stubFetch({ recording: () => transcript({ segments: [], audibility: "poor" }) });
  try {
    const r = await runCheck({ input: { type: "audio", value: MP3 } }, deps());
    assertEquals(r.status, "needs_clarification");
    assertEquals(s.calls.filter((c) => c.url.hostname === "openrouter.ai").length, 1);
  } finally {
    s.restore();
  }
} });

Deno.test({ ...T, name: "transcription fails (402 no credit) → technical_error, never a verdict", async fn() {
  const s = stubFetch({ status: (schema) => (schema === "video_transcription" ? 402 : undefined) });
  try {
    const r = await runCheck({ input: { type: "video", value: MP4 } }, deps());
    valid(r);
    assertEquals(r.status, "technical_error");
    assertEquals(r.claims.length, 0);
    assert(r.system_message?.text.includes("nagrania wideo"));
  } finally {
    s.restore();
  }
} });
