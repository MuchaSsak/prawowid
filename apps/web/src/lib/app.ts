/**
 * The web channel: one composer (text + one optional image / video / audio file) that calls
 * POST /api/v1/check.
 * Contract: .agents/project-info/architecture/api-reference.md
 */
import type { CheckRequest, CheckResponse, InputType } from "@prawdowid/core/types";
import { MEDIA_MIME, type MediaType } from "@prawdowid/core/media";
import type { MockScenario } from "@prawdowid/core/mock";
import { h } from "./dom.ts";
import { announce, renderResult, stateCard } from "./render.ts";
import { drawRosettes } from "./rosette.ts";

const MAX_BYTES = 5 * 1024 * 1024; // LIMITS.maxImageBytes / maxMediaBytes in core
const KIND_PL: Record<MediaType, string> = { image: "Zdjęcie", video: "Film", audio: "Nagranie" };
/** Extensions as a fallback for files the OS reports without a MIME type. */
const EXTRA_ACCEPT: Record<MediaType, string> = { image: "", video: ".mp4,.webm,.mov", audio: ".mp3,.wav,.m4a,.aac,.ogg,.oga,.weba" };
const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav",
  m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", weba: "audio/webm",
};

const STAGES: Record<InputType, string[]> = {
  text: ["Szukamy twierdzeń o faktach…", "Szukamy w źródłach…", "Porównujemy cytaty ze źródłami…", "Piszemy odpowiedź…"],
  url: ["Otwieramy stronę…", "Szukamy twierdzeń o faktach…", "Szukamy w źródłach…", "Piszemy odpowiedź…"],
  image: ["Wysyłamy zdjęcie…", "Odczytujemy tekst ze zdjęcia…", "Szukamy w źródłach…", "Piszemy odpowiedź…"],
  video: ["Wysyłamy film…", "Spisujemy, co mówią w filmie…", "Szukamy w źródłach…", "Piszemy odpowiedź…"],
  audio: ["Wysyłamy nagranie…", "Spisujemy, co słychać w nagraniu…", "Szukamy w źródłach…", "Piszemy odpowiedź…"],
};

/**
 * Browser recordings come out as WebM/Opus (Chrome) or MP4, which the EU transcription model can't
 * read (it takes mp3, wav, ogg). Re-encode to 16 kHz mono 16-bit WAV (~32 KB/s, 2 min ≈ 3.8 MB) so
 * voice messages stay on the EU route. Returns null if the browser can't decode it.
 */
async function toWav(blob: Blob): Promise<Blob | null> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const rate = 16_000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    out.setUint32(4, 36 + pcm.length * 2, true);
    str(8, "WAVEfmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); // PCM
    out.setUint16(22, 1, true); // mono
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, "data");
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([out.buffer], { type: "audio/wav" });
  } catch {
    return null;
  }
}

interface Attachment {
  kind: MediaType;
  file: File;
  dataUrl: string;
  previewUrl: string;
}

/** A round play / pause button instead of the browser's wide grey audio bar. */
function audioButton(src: string): HTMLElement {
  const audio = new Audio(src);
  audio.preload = "metadata";
  const PLAY = "M8 5.5v13l11-6.5z";
  const PAUSE = "M8 5h3v14H8zM13 5h3v14h-3z";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PLAY);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  const btn = h("button", { type: "button", class: "audio-btn", "aria-label": "Odtwórz nagranie", title: "Odtwórz nagranie" }, svg) as HTMLButtonElement;
  const sync = () => {
    const on = !audio.paused;
    path.setAttribute("d", on ? PAUSE : PLAY);
    btn.setAttribute("aria-label", on ? "Zatrzymaj nagranie" : "Odtwórz nagranie");
    btn.title = btn.getAttribute("aria-label")!;
  };
  audio.addEventListener("play", sync);
  audio.addEventListener("pause", sync);
  audio.addEventListener("ended", sync);
  btn.addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()));
  return btn;
}

function sessionId(): string {
  try {
    let id = localStorage.getItem("prawdowid_session");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("prawdowid_session", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function readAsDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // Re-label the data URL with the base MIME type: fills in a type inferred from the extension
    // and drops parameters such as ";codecs=opus".
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*?(;base64)?,/, `data:${mime.split(";")[0]};base64,`));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function fileMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  return EXT_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function kindOf(mime: string): MediaType | null {
  const base = mime.split(";")[0];
  for (const k of ["image", "video", "audio"] as const) if (MEDIA_MIME[k].includes(base)) return k;
  return null;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

/**
 * ?test=true only: a picture behind every sample answer, so the backdrop shows without a file.
 * Picked by the first sentence's topic, then by input type, then in rotation. All public domain
 * (White House and Library of Congress photos via Wikimedia Commons), see public/sample/README.md.
 */
const SAMPLE_BY_TOPIC: [RegExp, string][] = [
  [/bibliotek/i, "/sample/library.jpg"],
  [/\bmost/i, "/sample/bridge.jpg"],
  [/park/i, "/sample/park.jpg"],
  [/budżet|burmistrz|komunikac|miast/i, "/sample/city-hall.jpg"],
];
const SAMPLE_BY_TYPE: Partial<Record<InputType, string>> = {
  url: "/sample/trump-speech.jpg",
  image: "/sample/trump-oval-office.jpg",
  video: "/sample/trump-video-frame.jpg",
};
const SAMPLE_POOL = Object.values(SAMPLE_BY_TYPE).concat(SAMPLE_BY_TOPIC.map(([, src]) => src));
let samplePick = 0;
function sampleBackdrop(r: CheckResponse): string {
  const byType = SAMPLE_BY_TYPE[r.input.type];
  if (byType) return byType;
  const text = r.claims[0]?.text ?? "";
  return SAMPLE_BY_TOPIC.find(([re]) => re.test(text))?.[1] ?? SAMPLE_POOL[samplePick++ % SAMPLE_POOL.length];
}

/**
 * One still frame of a video (about a quarter in, at most 1 s), as an object URL of a JPEG, for the
 * answer's backdrop. Resolves null if the browser cannot decode the video or takes over 4 s.
 */
function videoFrame(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(src);
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), 4000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 4);
    }, { once: true });
    video.addEventListener("seeked", () => {
      const w = video.videoWidth, hgt = video.videoHeight;
      if (!w || !hgt) return finish(null);
      const scale = Math.min(1, 960 / w);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(hgt * scale);
      try {
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.8);
      } catch {
        finish(null);
      }
    }, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    video.src = src;
  });
}

export function initApp() {
  drawRosettes();
  const api = (document.body.dataset.api ?? "http://localhost:8787").replace(/\/$/, "");
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = $<HTMLFormElement>("check-form");
  const text = $<HTMLTextAreaElement>("text-input");
  const fileInput = $<HTMLInputElement>("file-input");
  const attachmentBox = $<HTMLDivElement>("attachment");
  const attachmentMedia = $<HTMLDivElement>("attachment-media");
  const formError = $<HTMLParagraphElement>("form-error");
  const sendAs = $<HTMLParagraphElement>("send-as");
  const mic = $<HTMLButtonElement>("mic");
  const submit = $<HTMLButtonElement>("submit");
  const thread = $<HTMLElement>("thread");
  const dock = $<HTMLDivElement>("dock");
  const newChat = $<HTMLButtonElement>("new-chat");
  const srStatus = $<HTMLParagraphElement>("sr-status");
  const overlay = $<HTMLDivElement>("drop-overlay");

  let attachment: Attachment | null = null;

  // ── "Usuń dane sesji": DELETE /api/v1/session/:id, then a fresh id ─────────
  const toast = $<HTMLParagraphElement>("toast");
  let toastTimer = 0;
  const showToast = (msg: string) => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3000);
  };
  $<HTMLButtonElement>("forget-session").addEventListener("click", async () => {
    try {
      const res = await fetch(`${api}/api/v1/session/${encodeURIComponent(sessionId())}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      localStorage.removeItem("prawdowid_session");
      showToast("Dane sesji usunięte.");
    } catch {
      showToast("Nie udało się usunąć danych. Spróbuj ponownie.");
    }
  });

  // ── ?test=true: sample data made in the browser, no API calls ──────────────
  // Each plain text send shows the next scenario, so every edge case can be clicked through;
  // `demo:<name>`, a link or a file picks its own scenario.
  // Dev mode: ?dev=true, or the older ?test=true. Also toggled from the bubble on the logo.
  const params = new URLSearchParams(location.search);
  let testMode = params.get("dev") === "true" || params.get("test") === "true";
  const devToggle = $<HTMLButtonElement>("dev-toggle");
  const testBar = $<HTMLDivElement>("test-bar");
  const testScenario = $<HTMLSpanElement>("test-scenario");
  let testIndex = 0;
  // The fixtures are only needed with ?test=true, so they are fetched on demand, not with the page.
  let mockModule: Promise<typeof import("@prawdowid/core/mock")> | null = null;
  const loadMock = () => (mockModule ??= import("@prawdowid/core/mock"));
  const nextScenario = (mock: typeof import("@prawdowid/core/mock"), req: CheckRequest): MockScenario => {
    const { MOCK_SCENARIOS, pickScenario } = mock;
    const explicit = /^demo:/i.test(req.input.value.trim()) || req.input.type !== "text";
    const s = explicit ? pickScenario(req) : MOCK_SCENARIOS[testIndex++ % MOCK_SCENARIOS.length];
    testScenario.textContent = `${s} (${MOCK_SCENARIOS.indexOf(s) + 1}/${MOCK_SCENARIOS.length})`;
    return s;
  };
  const setTestMode = (on: boolean) => {
    testMode = on;
    testBar.hidden = !on;
    document.body.classList.toggle("is-test", on);
    devToggle.textContent = on ? "Wyłączyć dev mode?" : "Dev mode?";
    devToggle.setAttribute("aria-pressed", String(on));
    if (on) loadMock(); // warm it up so the first sample answer does not wait on the network
  };
  setTestMode(testMode);
  const switchDevMode = (on: boolean) => {
    setTestMode(on);
    const url = new URL(location.href);
    url.searchParams.delete("test");
    if (on) url.searchParams.set("dev", "true");
    else url.searchParams.delete("dev");
    history.replaceState(null, "", url);
  };
  $<HTMLButtonElement>("test-off").addEventListener("click", () => switchDevMode(false));
  devToggle.addEventListener("click", () => {
    switchDevMode(!testMode);
    devToggle.blur();
  });
  let busy = false;
  let recording = false;

  // ── input type the request will use ────────────────────────────────────────
  const inputType = (): InputType => attachment?.kind ?? (isUrl(text.value.trim()) ? "url" : "text");
  // The hint must fit on one line of the field: a placeholder never scrolls and browsers clip it
  // mid-word, so the long version is used only when it measures shorter than the field.
  const measure = document.createElement("canvas").getContext("2d");
  const fits = (hint: string) => {
    if (!measure || !text.clientWidth) return false;
    const cs = getComputedStyle(text);
    measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = text.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return measure.measureText(hint).width <= room;
  };
  const pick = (long: string, short: string) => (fits(long) ? long : short);
  const refreshHint = () => {
    const chat = document.body.classList.contains("is-chat");
    text.placeholder = attachment
      ? pick("Co sprawdzić w tym pliku? Możesz zostawić puste", "Pytanie (opcjonalnie)")
      : chat
      ? pick("Kolejne pytanie lub link", "Kolejne pytanie")
      : pick("Spróbuj: „Czy płaca minimalna wzrosła w 2025 roku?”", "Wklej tekst lub link");
  };
  /** The line under the input is used only by the recorder; otherwise only the placeholder changes. */
  const refreshSendAs = () => {
    if (recording) return; // the recorder owns the line while it runs
    sendAs.textContent = "";
    refreshHint();
  };
  // Re-pick the hint when the field's width changes (rotation, resized window, chat layout).
  let hintWidth = 0;
  new ResizeObserver(() => {
    if (text.clientWidth === hintWidth) return; // height changes from autoGrow don't matter
    hintWidth = text.clientWidth;
    refreshHint();
  }).observe(text);
  // Web fonts change the measured width once they load.
  document.fonts?.ready.then(refreshHint);

  const showError = (msg: string | null) => {
    formError.hidden = !msg;
    formError.textContent = msg ?? "";
  };

  const autoGrow = () => {
    text.style.height = "auto";
    const max = document.body.classList.contains("is-chat") ? 160 : 240;
    text.style.height = `${Math.min(text.scrollHeight + 2, max)}px`;
  };
  text.addEventListener("input", () => {
    autoGrow();
    refreshSendAs();
    showError(null);
  });

  // ── attachments ────────────────────────────────────────────────────────────
  const clearAttachment = () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    attachment = null;
    attachmentBox.hidden = true;
    attachmentMedia.replaceChildren();
    refreshSendAs();
  };

  // Reads are async: a newer file, or "Nowe pytanie", makes an older read obsolete.
  let attachSeq = 0;
  let loadingFile = false;
  const LOADING_NOTICE = "Chwileczkę, wczytujemy plik.";
  const attach = async (file: File | undefined) => {
    if (!file) return;
    const seq = ++attachSeq;
    loadingFile = false;
    showError(null);
    const mime = fileMime(file);
    const kind = kindOf(mime);
    if (!kind) {
      showError("Tego pliku nie obsługujemy. Dołącz zdjęcie (JPG, PNG, WebP), film (MP4, WebM, MOV) albo nagranie (MP3, WAV, M4A, OGG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError(`Plik ma ${formatSize(file.size)}, a limit to 5 MB. Wybierz krótszy fragment lub mniejszy plik.`);
      return;
    }
    if (file.size === 0) {
      showError("Ten plik jest pusty.");
      return;
    }
    loadingFile = true;
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file, mime);
    } catch {
      if (seq === attachSeq) {
        loadingFile = false;
        showError("Nie udało się wczytać pliku. Spróbuj jeszcze raz.");
      }
      return;
    }
    if (seq !== attachSeq) return;
    loadingFile = false;
    if (formError.textContent === LOADING_NOTICE) showError(null);
    clearAttachment();
    const previewUrl = URL.createObjectURL(file);
    attachment = { kind, file, dataUrl, previewUrl };

    const media = kind === "image"
      ? h("img", { src: previewUrl, alt: "Podgląd dołączonego zdjęcia" })
      : kind === "video"
      ? h("video", { src: previewUrl, preload: "metadata", playsinline: true, title: "Kliknij, aby odtworzyć lub zatrzymać" })
      : audioButton(previewUrl);
    if (media instanceof HTMLVideoElement) {
      media.addEventListener("click", () => (media.paused ? media.play() : media.pause()));
    }
    attachmentMedia.className = `attachment-media is-${kind}`;
    attachmentMedia.replaceChildren(media);
    $("attachment-kind").textContent = KIND_PL[kind];
    $("attachment-name").textContent = file.name || "wklejony plik";
    $("attachment-size").textContent = formatSize(file.size);
    attachmentBox.hidden = false;
    refreshSendAs();
    text.focus();
  };

  // One paperclip for every supported kind; the file's type decides image / video / audio.
  fileInput.accept = (["image", "video", "audio"] as const)
    .flatMap((k) => [...MEDIA_MIME[k], EXTRA_ACCEPT[k]])
    .filter(Boolean)
    .join(",");
  $<HTMLButtonElement>("attach").addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });
  fileInput.addEventListener("change", () => attach(fileInput.files?.[0]));

  // ── voice message: record in the browser, attach as audio ─────────────────
  const MAX_RECORDING_S = 120; // ~3.8 MB once re-encoded to 16 kHz WAV, under the 5 MB cap
  let recorder: MediaRecorder | null = null;
  let micBusy = false; // permission prompt open: ignore further clicks
  let micGen = 0; // bumped by "Nowe pytanie": a late permission grant or stop event is dropped
  let recTimer: ReturnType<typeof setInterval> | undefined;
  const setRecording = (on: boolean) => {
    recording = on;
    mic.classList.toggle("is-recording", on);
    sendAs.classList.toggle("is-live", on);
    mic.setAttribute("aria-pressed", String(on));
    mic.setAttribute("aria-label", on ? "Zakończ nagrywanie" : "Nagraj wiadomość głosową");
    mic.title = on ? "Zakończ nagrywanie" : "Nagraj wiadomość głosową";
    if (!on) refreshSendAs();
  };
  mic.addEventListener("click", async () => {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    if (micBusy) return;
    showError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showError("Ta przeglądarka nie pozwala nagrywać. Dołącz gotowy plik z nagraniem.");
      return;
    }
    let stream: MediaStream;
    const gen = micGen;
    micBusy = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (gen === micGen) showError("Nie mamy dostępu do mikrofonu. Zezwól na mikrofon w ustawieniach przeglądarki albo dołącz plik z nagraniem.");
      return;
    } finally {
      micBusy = false;
    }
    if (gen !== micGen) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      rec.start();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      showError("Nie udało się rozpocząć nagrywania. Dołącz plik z nagraniem.");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      recorder = null;
      setRecording(false);
      if (gen !== micGen) return;
      const mime = (rec.mimeType || type || "audio/webm").split(";")[0];
      const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
      const wav = await toWav(new Blob(chunks, { type: mime }));
      if (gen !== micGen) return;
      attach(wav
        ? new File([wav], `nagranie-${stamp}.wav`, { type: "audio/wav" })
        : new File(chunks, `nagranie-${stamp}.${mime.split("/")[1]}`, { type: mime }));
    };
    recorder = rec;
    const started = Date.now();
    setRecording(true);
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      sendAs.textContent = `Nagrywamy: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. Kliknij mikrofon, żeby zakończyć.`;
      if (s >= MAX_RECORDING_S) rec.stop();
    };
    tick();
    recTimer = setInterval(tick, 250);
  });
  $<HTMLButtonElement>("attachment-remove").addEventListener("click", () => {
    attachSeq++; // a replacement still loading must not reappear
    loadingFile = false;
    if (formError.textContent === LOADING_NOTICE) showError(null);
    clearAttachment();
    text.focus();
  });

  // Drag a file anywhere onto the page.
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    attach(e.dataTransfer?.files?.[0]);
  });
  // Paste a screenshot (or any supported file) from the clipboard.
  document.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files ?? [])][0];
    if (file) {
      e.preventDefault();
      attach(file);
    }
  });

  // ── chat state: first screen is the big composer, then a thread with the composer docked ──
  const enterChat = () => {
    if (document.body.classList.contains("is-chat")) return;
    document.body.classList.add("is-chat");
    newChat.hidden = false;
    refreshSendAs();
    autoGrow();
  };
  const leaveChat = () => {
    attachSeq++; // drop a file that is still loading
    loadingFile = false;
    micGen++; // pending permission or a queued stop event must not attach into the new chat
    if (recorder?.state === "recording") recorder.stop();
    for (const url of bubbleUrls.splice(0)) URL.revokeObjectURL(url);
    document.body.classList.remove("is-chat");
    newChat.hidden = true;
    thread.replaceChildren();
    clearAttachment();
    text.value = "";
    showError(null);
    refreshSendAs();
    autoGrow();
    window.scrollTo({ top: 0 });
    text.focus();
  };
  newChat.addEventListener("click", leaveChat);

  // Keep the last message clear of the docked composer, whatever its current height.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
  }).observe(dock);

  const scrollToEnd = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });

  /** The user's side of a turn: what they typed plus a small preview of the file. */
  const bubbleUrls: string[] = []; // revoked on "Nowe pytanie"
  const userBubble = (typed: string, att: Attachment | null): HTMLElement => {
    let media: HTMLElement | null = null;
    if (att) {
      const url = URL.createObjectURL(att.file);
      bubbleUrls.push(url);
      media = att.kind === "image"
        ? h("img", { src: url, alt: "Dołączone zdjęcie" })
        : att.kind === "video"
        ? h("video", { src: url, controls: true, preload: "metadata", playsinline: true })
        : audioButton(url);
    }
    return h(
      "div",
      { class: "turn turn-user" },
      h(
        "div",
        { class: "bubble" },
        att
          ? h(
            "div",
            { class: `bubble-file is-${att.kind}` },
            media,
            h("span", { class: "bubble-file-name" }, `${KIND_PL[att.kind]}: ${att.file.name || "plik"}, ${formatSize(att.file.size)}`),
          )
          : null,
        typed ? h("p", { class: "bubble-text" }, typed) : null,
      ),
    );
  };

  /** The reply's avatar is the rosette mark; it turns while the check runs. */
  const avatar = (): HTMLElement => {
    const el = h("div", { class: "bot-avatar", "aria-hidden": "true" });
    const mark = document.getElementById("mark")?.cloneNode(true) as SVGElement | undefined;
    if (mark) {
      mark.removeAttribute("id");
      el.append(mark);
    }
    return el;
  };

  /** Placeholder shaped like one answer card (eyebrow, verdict pill, headline, text), shimmering. */
  const skeleton = (): HTMLElement => {
    const line = (cls: string) => h("span", { class: `skel-line ${cls}` });
    return h(
      "div",
      { class: "skel", "aria-hidden": "true" },
      h(
        "div",
        { class: "skel-card" },
        h("div", { class: "skel-row" }, line("w-25"), line("w-15")),
        h("span", { class: "skel-pill" }),
        line("is-lg w-90"),
        line("is-lg w-55"),
        line("w-100"),
        line("w-80"),
      ),
    );
  };

  const botTurn = (): { el: HTMLElement; body: HTMLElement; status: HTMLElement } => {
    const status = h("p", { class: "progress" });
    const body = h("div", { class: "result" }, skeleton());
    const el = h("div", { class: "turn turn-bot is-waiting" }, avatar(), h("div", { class: "bot-body" }, status, body));
    return { el, body, status };
  };

  // ── Stop (like ChatGPT): while a check runs, the send button turns into a red stop button;
  // a click on it or Escape cancels the request and leaves a quiet "Zatrzymano" line. ──────────
  let abort: AbortController | null = null;
  const sendChildren = [...submit.childNodes];
  const stopIcon = (() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const sq = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [k, v] of Object.entries({ x: "7", y: "7", width: "10", height: "10", rx: "2" })) sq.setAttribute(k, v);
    svg.append(sq);
    return svg;
  })();
  const stopLabel = h("span", { class: "send-label", "aria-hidden": "true" }, "Zatrzymaj");
  const setStopMode = (on: boolean) => {
    submit.classList.toggle("is-stop", on);
    submit.replaceChildren(...(on ? [stopLabel, stopIcon] : sendChildren));
    const label = on ? "Zatrzymaj sprawdzanie (Esc)" : "Sprawdź";
    submit.setAttribute("aria-label", label);
    submit.title = label;
  };
  const stop = () => abort?.abort(new DOMException("Zatrzymano", "AbortError"));
  submit.addEventListener("click", (e) => {
    if (!busy) return;
    e.preventDefault(); // a click while busy is "stop", never a new send
    stop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && busy) {
      e.preventDefault();
      stop();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    if (loadingFile) {
      showError(LOADING_NOTICE);
      return;
    }
    const typed = text.value.trim();
    const type = inputType();
    if (!attachment && !typed) {
      showError("Wpisz treść do sprawdzenia albo dołącz plik.");
      text.focus();
      return;
    }
    showError(null);
    const att = attachment;
    const req: CheckRequest = {
      input: { type, value: att ? att.dataUrl : typed },
      session_id: sessionId(),
      channel: "web",
    };
    if (att && typed) req.user_message = typed.slice(0, 2000);
    // The picture behind the answer: the photo itself, or a frame of the video (captured now,
    // in parallel with the check). Object URLs are revoked on "Nowe pytanie".
    const keep = (url: string | null) => (url && bubbleUrls.push(url), url);
    const backdropReady: Promise<string | null> = att?.kind === "image"
      ? Promise.resolve(keep(URL.createObjectURL(att.file)))
      : att?.kind === "video"
      ? videoFrame(att.file).then(keep)
      : Promise.resolve(null);

    // Post the user's message, clear the composer and dock it at the bottom.
    enterChat();
    const bot = botTurn();
    thread.append(userBubble(typed, att), bot.el);
    text.value = "";
    clearAttachment();
    autoGrow();
    requestAnimationFrame(scrollToEnd);

    busy = true;
    const controller = new AbortController();
    abort = controller;
    setStopMode(true);
    form.classList.add("is-busy");
    // Recordings add a transcription call; the core allows them 55 s (LIMITS.recordingRequestDeadlineMs).
    const waitMs = type === "video" || type === "audio" ? 70_000 : 40_000;
    const timeoutId = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), waitMs);
    // Rejects as soon as the request is stopped or times out, so every wait below ends at once.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    aborted.catch(() => {});
    const guard = <T>(p: Promise<T>) => Promise.race([p, aborted]);
    const stages = STAGES[type];
    let stage = 0;
    bot.status.textContent = stages[0];
    const timer = setInterval(() => {
      stage = Math.min(stage + 1, stages.length - 1);
      bot.status.textContent = stages[stage];
    }, testMode ? 450 : 2500);

    // The skeleton stays at least 1-1.5 s (sample data answers instantly, a fast API almost so):
    // shorter, it only flashes.
    const started = performance.now();
    const minShow = 1000 + Math.random() * 500;
    const settle = () => new Promise((r) => setTimeout(r, Math.max(0, minShow - (performance.now() - started))));

    let data: CheckResponse;
    try {
      if (testMode) {
        const mock = await guard(loadMock());
        data = mock.mockResponse(req, nextScenario(mock, req));
      } else {
        const res = await guard(fetch(`${api}/api/v1/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        }));
        data = (await guard(res.json())) as CheckResponse;
      }
      await guard(settle());
      const backdrop = (await guard(backdropReady)) ?? (testMode ? sampleBackdrop(data) : null);
      renderResult(bot.body, data, { backdrop });
      srStatus.textContent = announce(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Stopped by the person: not an answer and not an error, just a quiet line.
        bot.body.replaceChildren(h("p", { class: "stopped" }, "Zatrzymano"));
        srStatus.textContent = "Sprawdzanie zatrzymane.";
        return;
      }
      const timeout = err instanceof DOMException && err.name === "TimeoutError";
      await settle();
      bot.body.replaceChildren(
        stateCard(
          timeout ? "Serwer nie odpowiedział na czas" : "Brak połączenia z serwerem",
          ["Spróbuj ponownie za chwilę. To nie jest ocena prawdziwości."],
        ),
      );
      srStatus.textContent = "Nie udało się uzyskać odpowiedzi.";
    } finally {
      clearTimeout(timeoutId);
      clearInterval(timer);
      abort = null;
      setStopMode(false);
      bot.status.remove();
      bot.el.classList.remove("is-waiting");
      busy = false;
      form.classList.remove("is-busy");
      if (controller.signal.reason?.name === "AbortError") {
        text.focus({ preventScroll: true });
        return;
      }
      // Show the answer from its top and move focus to its heading (screen readers read the
      // result next; on phones no keyboard pops up), unless the person already started typing
      // the next question: then leave their focus and scroll alone.
      if (!text.value.trim() && !attachment && !recording && !loadingFile) {
        bot.el.scrollIntoView({ behavior: "smooth", block: "start" });
        (bot.body.querySelector(".answer-title, .verdict") as HTMLElement | null)?.focus({ preventScroll: true });
      }
    }
  });

  // Enter sends (chat style), Shift+Enter adds a new line.
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  refreshSendAs();
  autoGrow();
}
