# Multimodal input: articles with images, video and audio
How we turn a linked article's images, YouTube or MP4 videos and audio into text the verification pipeline can check, and which model does it. **Idea**: a recommendation, not decided. Verified on 2026-11-21 against the live OpenRouter model list (`/api/v1/models`, 476 models) and the OpenRouter docs (multimodal/videos, multimodal/audio).

## Verified facts (OpenRouter, 2026-11-21)
- **Video** goes through the **Responses API** (`/api/v1/responses`) with the `input_video` content type, or through chat completions with `video_url` (what our code uses). `videoUrl` is either a URL or a **base64 data URL**. Formats: mp4, mpeg, mov, webm.
- **YouTube:** "Google Gemini on AI Studio only supports YouTube links (not Vertex AI)". So a YouTube URL can be passed **directly** if we pin the provider to Google AI Studio. Any other video (an MP4 on a CDN) must be **downloaded by us and sent as base64**.
- **Audio** goes through `input_audio`, **base64 only** (no URLs). The Responses API accepts wav and mp3.
- Models accepting **text + image + audio + video** (prices per 1M input/output tokens):

| Model | In / Out | Notes |
|---|---|---|
| `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | cheapest full-omni model from a major vendor, 1M ctx |
| `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | newer and stronger; **recommended media + reasoning workhorse** |
| `google/gemini-3.7-flash` / `3.8-flash` | ~$0.75-0.83 / ~$3.75-4.1 | upgrade if the eval shows quality gaps |
| `google/gemini-3.1-pro-preview` | $2 / $12 | too expensive for the per-check path |
| `qwen/qwen3.8-omni-flash` | $0.15 / $0.47 | omni alternative (non-EU vendor) |
| `mistralai/voxtral-small-24b-2507` | $0.10 / $0.30 | **EU vendor**, audio + text only, for transcription (sovereignty option) |
| `google/gemma-4-*:free`, `nvidia/nemotron-*:free` | free | **dev only**: rate-limited, and prompts may be logged |

- `typesafe/jev-router` exists on OpenRouter (all modalities, router pricing). It is probably the "jev" the team mentioned. Unconfirmed.

## Status (2026-11-21): uploaded recordings work live
Uploaded `video` and `audio` files (data URLs, max 5 MB, [decision 009](../decisions/009-video-audio-input-and-web-composer.md)) are transcribed live by `packages/core/src/intake/recording.ts`, then go through the normal pipeline. Linked videos (YouTube, MP4 inside an article) are **not built yet** (steps 3-4 below).
- **Routing by format** (probed with our key, 2026-11-21, OpenRouter chat completions): Voxtral (`mistral/eu`) decodes **mp3, wav and ogg/opus** and rejects webm and m4a ("valid mp3 or wav"). So audio in those three formats goes to `audio_transcription` (Voxtral, EU); webm, m4a/mp4 and aac audio and **every video** go to `video_transcription` (Gemini 3.1 Flash-Lite, non-EEA), and the response gets the limitation "przetworzone przez model Google poza EOG".
- **Content parts:** audio `{type:"input_audio", input_audio:{data:<bare base64>, format}}`; video `{type:"video_url", video_url:{url:"data:video/mp4;base64,…"}}`, both on `/chat/completions` (no Responses API needed). Gemini also reads webm/ogg audio.
- **Web mic:** the browser records WebM/Opus, so `apps/web` re-encodes it to 16 kHz mono WAV (~32 KB/s, 2 min ≈ 3.8 MB) before sending, which keeps voice messages on the EU route. If decoding fails it sends the original.
- **Output → material:** one item per speaker turn with provenance `audio@mm:ss` / `video@mm:ss`; on-screen text becomes `[Tekst na ekranie] …` items. Capped at `maxMaterialChars` (warning "przeanalizowaliśmy jego początek"). Unclear audio → `illegible_media` warning; no speech and no user message → `needs_clarification`. Every recording answer carries the limitation that we don't judge authenticity or edits.
- **Time budget:** recordings get a 55 s request deadline (`recordingRequestDeadlineMs`, 25 s for the transcription call); the web app waits 70 s for them instead of 40 s.
- **Measured (one synthetic 7 s English clip, 2026-11-21):** mp3 via Voxtral ~14 s end-to-end, $0.0067 for the whole check; webm via Gemini ~18 s, $0.0029. Too small a sample for the cost sheet.
- **Video is blocked by the account for now:** OpenRouter answers 402 "requires at least $1.00 in balance for video" because the API key has a low spend limit. The pipeline returns `technical_error` ("Konto usługi modelu nie ma wystarczających środków"), never a verdict. See [open-questions](../open-questions.md).

## Design: "media → text" first, then the normal pipeline
1. **Fetch the article** (SSRF-safe). Readability gives the main text + publish date. Collect `<img>` (skip logos and icons by size), `<video>`/`<source>` MP4s, and YouTube `<iframe>` embeds.
2. **Images:** send the top ~3 to the media model → OCR text + a short description + any visible date. Read EXIF with `exifr` (skip GPS). Redact PII in the OCR text before the next step ([intake rules](verification-pipeline.md#1-validate-and-prepare-input)).
3. **YouTube:** pass the URL to Gemini (provider pinned to Google AI Studio) → a **transcript with timestamps** + on-screen text + a short visual description. We **don't download from YouTube** (its ToS forbids it). Google's own model reads it, which is legitimate.
4. **MP4 / CDN video:** download with caps (e.g. **≤ 10 min, ≤ 50 MB**, timeout), base64 → Gemini → transcript + on-screen text.
5. **Other platforms** (TikTok, X, Facebook, Instagram): no legal download, so return the system state **"nie możemy przeanalizować tego wideo"** (not a verdict). A user upload of the file is the alternative.
6. All extracted text is **untrusted input**: PII-masked, injection-scanned and spotlighted. A video can *say* "ignore your instructions". Then claims get extracted with a **provenance tag** (article text / image #2 / video 01:23) so citations can point to the exact moment.

## Cost and latency
- **Assumption** (Google's published token rates, to be measured): video ≈ 260-300 tokens per second at default resolution (≈ 100 at low media resolution); audio ≈ 32 tokens per second. A 5-minute video ≈ 90k tokens ≈ **$0.01-0.02** on 2.5 or 3.1 Flash-Lite. A transcript-only request with low media resolution is cheaper.
- The 30 s median target applies to **text and URL**. Video runs **asynchronously**: text claims are answered first, and video findings stream in or follow up. Show progress ("analizuję nagranie…").

## Limits to disclose (the brief requires it)
- We transcribe and read; we **don't detect deepfakes or edits**. We don't claim a reverse video or image search unless one actually runs.
- Google is a non-EEA vendor. Disclose where data is processed. The swap options are Voxtral (EU) for audio, and a self-hosted Gemma for vision later.
- Caps: duration and size limits, the platforms we don't support, and the provider failure → system state `technical_error` (never a verdict).
