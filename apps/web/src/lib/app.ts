/**
 * The web channel: one composer (text + one optional image / video / audio file) that calls
 * POST /api/v1/check. Demo mode (the default for now) sends `mock`, so it works with no keys.
 * Contract: .agents/project-info/architecture/api-reference.md
 */
import type { CheckRequest, CheckResponse, InputType } from "@prawdowid/core/types";
import { MEDIA_MIME, type MediaType } from "@prawdowid/core/media";
import { h } from "./dom.ts";
import { announce, renderResult, stateCard } from "./render.ts";
import { drawRosettes } from "./rosette.ts";

const MAX_BYTES = 5 * 1024 * 1024; // LIMITS.maxImageBytes / maxMediaBytes in core
const KIND_PL: Record<MediaType, string> = { image: "Zdjęcie", video: "Film", audio: "Nagranie" };
const SEND_AS_PL: Record<InputType, string> = {
  text: "tekst",
  url: "link",
  image: "zdjęcie",
  video: "film",
  audio: "nagranie",
};
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

interface Attachment {
  kind: MediaType;
  file: File;
  dataUrl: string;
  previewUrl: string;
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

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the setting just isn't remembered
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

/** For the JSON panel: never dump megabytes of base64 into the page. */
function shortenDataUrl(v: string): string {
  return v.startsWith("data:") && v.length > 120 ? `${v.slice(0, 60)}… (${formatSize((v.length * 3) / 4)} base64)` : v;
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
  const scenario = $<HTMLSelectElement>("scenario");
  const scenarioWrap = $<HTMLLabelElement>("scenario-wrap");
  const modeHint = $<HTMLParagraphElement>("mode-hint");
  const modeSummary = $<HTMLSpanElement>("mode-summary");
  const overlay = $<HTMLDivElement>("drop-overlay");

  let attachment: Attachment | null = null;
  let mode: "mock" | "live" = stored("prawdowid_mode") === "live" ? "live" : "mock";
  let serverMode: "mock" | "live" | null = null;
  let busy = false;
  let recording = false;

  // ── input type the request will use ────────────────────────────────────────
  const inputType = (): InputType => attachment?.kind ?? (isUrl(text.value.trim()) ? "url" : "text");
  /** The line under the input: what will be sent, or how to attach a file. */
  const refreshSendAs = () => {
    if (recording) return; // the recorder owns the line while it runs
    const t = inputType();
    const hasText = text.value.trim().length > 0;
    sendAs.textContent = attachment
      ? `Wyślemy ${SEND_AS_PL[t]}${hasText ? " z Twoim pytaniem" : ""}.`
      : t === "url"
      ? "Sprawdzimy artykuł spod tego linku."
      : "Możesz też dołączyć zdjęcie, film lub nagranie do 5 MB albo nagrać wiadomość głosową.";
    const chat = document.body.classList.contains("is-chat");
    text.placeholder = attachment
      ? "Co sprawdzić w tym pliku? Możesz zostawić puste"
      : chat
      ? window.matchMedia("(max-width: 720px)").matches ? "Kolejne pytanie" : "Kolejne pytanie lub link"
      : window.matchMedia("(max-width: 720px)").matches
      ? "Wklej tekst lub link"
      : "Spróbuj: „Czy płaca minimalna wzrosła w 2025 roku?”";
  };

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
      : h("audio", { src: previewUrl, controls: true, preload: "metadata" });
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
  const MAX_RECORDING_S = 120; // ~0.5 MB of Opus, far under the 5 MB cap
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
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      recorder = null;
      setRecording(false);
      if (gen !== micGen) return;
      const mime = (rec.mimeType || type || "audio/webm").split(";")[0];
      const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
      attach(new File(chunks, `nagranie-${stamp}.${mime.split("/")[1]}`, { type: mime }));
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

  // ── mode: demo (mock) vs live ──────────────────────────────────────────────
  const refreshMode = () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
      b.setAttribute("aria-checked", String(b.dataset.mode === mode));
    }
    scenarioWrap.hidden = mode !== "mock";
    modeSummary.textContent = mode === "mock" ? "Demo: odpowiedzi przykładowe" : "Na żywo: prawdziwe sprawdzenie";
    modeHint.textContent = mode === "mock"
      ? "Przykładowe odpowiedzi z API o fikcyjnym mieście, bez kosztów. Filmy i nagrania działają na razie tylko tutaj."
      : serverMode === "mock"
      ? "Serwer działa w trybie demo, więc i tak odpowie danymi przykładowymi."
      : "Prawdziwe sprawdzenie w źródłach. Trwa 5 do 10 sekund.";
    store("prawdowid_mode", mode);
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    b.addEventListener("click", () => {
      mode = b.dataset.mode as "mock" | "live";
      refreshMode();
    });
  }

  // ── server mode (no UI: only changes the hint when the server itself runs in demo mode) ──
  const checkHealth = async () => {
    try {
      const res = await fetch(`${api}/api/v1/health`, { signal: AbortSignal.timeout(6000) });
      serverMode = ((await res.json()) as { mode: "live" | "mock" }).mode;
    } catch {
      serverMode = null;
    }
    refreshMode();
  };

  const loadScenarios = async () => {
    try {
      const res = await fetch(`${api}/api/v1/mock/scenarios`, { signal: AbortSignal.timeout(6000) });
      const { scenarios } = await res.json() as { scenarios: Record<string, string> };
      const saved = stored("prawdowid_scenario") ?? "";
      scenario.replaceChildren(
        h("option", { value: "" }, "dobierz sam"),
        ...Object.entries(scenarios).map(([name, desc]) => h("option", { value: name, title: desc }, name.replaceAll("_", " "))),
      );
      if (saved in scenarios) scenario.value = saved;
    } catch {
      // the list is a convenience; "automatycznie" still works
    }
  };
  scenario.addEventListener("change", () => store("prawdowid_scenario", scenario.value));

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
  // Starting over clears the conversation, so ask first (easy to tap by accident).
  newChat.addEventListener("click", () => {
    if (!thread.childElementCount || window.confirm("Zacząć od nowa? Obecne odpowiedzi znikną z ekranu.")) leaveChat();
  });

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
        : h("audio", { src: url, controls: true, preload: "metadata" });
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

  const botTurn = (): { el: HTMLElement; body: HTMLElement; status: HTMLElement } => {
    const status = h("p", { class: "progress" });
    const body = h("div", { class: "result" });
    const el = h("div", { class: "turn turn-bot is-waiting" }, avatar(), h("div", { class: "bot-body" }, status, body));
    return { el, body, status };
  };

  const rawPanel = (req: CheckRequest, data: unknown, httpStatus: number | null): HTMLElement => {
    const shown = { ...req, input: { ...req.input, value: shortenDataUrl(req.input.value) } };
    return h(
      "details",
      { class: "raw" },
      h("summary", {}, "Pokaż zapytanie i odpowiedź API"),
      h(
        "div",
        { class: "raw-grid" },
        h("div", {}, h("h3", {}, "POST /api/v1/check"), h("pre", {}, JSON.stringify(shown, null, 2))),
        h(
          "div",
          {},
          h("h3", {}, httpStatus ? `Odpowiedź (HTTP ${httpStatus})` : "Odpowiedź"),
          h("pre", {}, data ? JSON.stringify(data, null, 2) : "(brak odpowiedzi)"),
        ),
      ),
    );
  };

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
    if (mode === "mock") req.mock = scenario.value || true;

    // Post the user's message, clear the composer and dock it at the bottom.
    enterChat();
    const bot = botTurn();
    thread.append(userBubble(typed, att), bot.el);
    text.value = "";
    clearAttachment();
    autoGrow();
    requestAnimationFrame(scrollToEnd);

    busy = true;
    submit.disabled = true;
    form.classList.add("is-busy");
    const stages = STAGES[type];
    let stage = 0;
    bot.status.textContent = stages[0];
    const timer = setInterval(() => {
      stage = Math.min(stage + 1, stages.length - 1);
      bot.status.textContent = stages[stage];
    }, mode === "mock" ? 250 : 2500);

    let httpStatus: number | null = null;
    let data: CheckResponse | null = null;
    try {
      const res = await fetch(`${api}/api/v1/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(40_000),
      });
      httpStatus = res.status;
      data = (await res.json()) as CheckResponse;
      renderResult(bot.body, data);
      srStatus.textContent = announce(data);
    } catch (err) {
      const timeout = err instanceof DOMException && err.name === "TimeoutError";
      bot.body.replaceChildren(
        stateCard(
          timeout ? "Serwer nie odpowiedział na czas" : "Brak połączenia z serwerem",
          ["Spróbuj ponownie za chwilę. To nie jest ocena prawdziwości."],
          h(
            "details",
            { class: "more tech" },
            h("summary", {}, "Szczegóły techniczne"),
            h("div", { class: "more-body tech-body" }, h("p", {}, timeout ? "Przekroczono czas oczekiwania (40 s)." : `Brak połączenia z API: ${api}.`)),
          ),
        ),
      );
      srStatus.textContent = "Nie udało się uzyskać odpowiedzi.";
    } finally {
      clearInterval(timer);
      bot.status.remove();
      bot.el.classList.remove("is-waiting");
      // The JSON goes inside "Szczegóły techniczne": useful to builders, noise to everyone else.
      (bot.body.querySelector(".tech-body") ?? bot.body).append(rawPanel(req, data, httpStatus));
      busy = false;
      submit.disabled = false;
      form.classList.remove("is-busy");
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

  $<HTMLButtonElement>("forget").addEventListener("click", async () => {
    let ok = true;
    try {
      const id = stored("prawdowid_session");
      if (id) await fetch(`${api}/api/v1/session/${encodeURIComponent(id)}`, { method: "DELETE" });
      try {
        localStorage.removeItem("prawdowid_session");
      } catch {
        // nothing stored
      }
    } catch {
      ok = false;
    }
    enterChat();
    thread.append(
      h(
        "div",
        { class: "turn turn-bot" },
        avatar(),
        h(
          "div",
          { class: "bot-body" },
          h(
            "div",
            { class: "system-banner" },
            h("strong", {}, ok ? "Dane sesji usunięte" : "Nie udało się usunąć danych sesji"),
            h("p", {}, ok ? "Usunęliśmy historię sprawdzeń tej sesji." : "Spróbuj ponownie za chwilę."),
          ),
        ),
      ),
    );
    requestAnimationFrame(scrollToEnd);
  });

  refreshMode();
  refreshSendAs();
  autoGrow();
  checkHealth();
  loadScenarios();
}
