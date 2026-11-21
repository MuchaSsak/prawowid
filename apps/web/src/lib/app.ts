import type { CheckResponse, InputType } from "@prawdowid/core/types";
import { h } from "./dom.ts";
import { renderResult } from "./render.ts";

const STAGES = [
  "Wyodrębniamy twierdzenia…",
  "Szukamy w źródłach…",
  "Czytamy źródła i porównujemy cytaty…",
  "Składamy odpowiedź…",
];

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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function initApp() {
  const api = document.body.dataset.api ?? "http://localhost:8787";
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = $<HTMLFormElement>("check-form");
  const text = $<HTMLTextAreaElement>("text-input");
  const url = $<HTMLInputElement>("url-input");
  const image = $<HTMLInputElement>("image-input");
  const note = $<HTMLInputElement>("note-input");
  const noteWrap = $<HTMLDivElement>("note-wrap");
  const preview = $<HTMLImageElement>("preview");
  const dropLabel = $<HTMLSpanElement>("drop-label");
  const submit = $<HTMLButtonElement>("submit");
  const progress = $<HTMLSpanElement>("progress");
  const result = $<HTMLElement>("result");
  const charCount = $<HTMLSpanElement>("char-count");
  let type: InputType = "text";
  let imageData: string | null = null;

  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.addEventListener("click", () => {
      type = tab.dataset.type as InputType;
      for (const t of document.querySelectorAll<HTMLButtonElement>(".tab")) {
        t.setAttribute("aria-selected", String(t === tab));
      }
      for (const p of document.querySelectorAll<HTMLElement>(".panel")) p.hidden = p.dataset.panel !== type;
      noteWrap.hidden = type === "text";
    });
  }

  text.addEventListener("input", () => (charCount.textContent = String(text.value.length)));

  const setImage = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      dropLabel.textContent = "Ten plik jest za duży (maks. 5 MB).";
      imageData = null;
      preview.hidden = true;
      return;
    }
    imageData = await readAsDataUrl(file);
    preview.src = imageData;
    preview.hidden = false;
    dropLabel.textContent = file.name;
  };
  image.addEventListener("change", () => setImage(image.files?.[0]));
  const drop = $<HTMLLabelElement>("drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    setImage(e.dataTransfer?.files?.[0]);
  });
  document.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) {
      (document.querySelector('.tab[data-type="image"]') as HTMLButtonElement).click();
      setImage(file);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = type === "text" ? text.value.trim() : type === "url" ? url.value.trim() : imageData;
    if (!value) {
      progress.textContent = type === "image" ? "Wybierz obraz." : "Wpisz treść do sprawdzenia.";
      return;
    }
    submit.disabled = true;
    result.replaceChildren(h("div", { class: "skeleton card" }), h("div", { class: "skeleton card" }));
    let stage = 0;
    progress.textContent = STAGES[0];
    const timer = setInterval(() => {
      stage = Math.min(stage + 1, STAGES.length - 1);
      progress.textContent = STAGES[stage];
    }, 2500);

    try {
      const res = await fetch(`${api}/api/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { type, value },
          user_message: type === "text" ? "" : note.value.trim(),
          session_id: sessionId(),
        }),
      });
      const data = (await res.json()) as CheckResponse;
      renderResult(result, data);
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      result.replaceChildren(
        h(
          "div",
          { class: "system-banner status-technical_error" },
          h("strong", {}, "Brak połączenia z serwerem"),
          h("p", {}, `Nie udało się połączyć z API (${api}). Sprawdź, czy serwer działa. To nie jest ocena treści.`),
        ),
      );
    } finally {
      clearInterval(timer);
      progress.textContent = "";
      submit.disabled = false;
    }
  });

  $<HTMLButtonElement>("forget").addEventListener("click", async () => {
    try {
      const id = localStorage.getItem("prawdowid_session");
      if (id) await fetch(`${api}/api/session/${encodeURIComponent(id)}`, { method: "DELETE" });
      localStorage.removeItem("prawdowid_session");
      result.replaceChildren(h("div", { class: "system-banner" }, h("strong", {}, "Dane sesji usunięte"), h("p", {}, "Usunęliśmy historię sprawdzeń tej sesji.")));
    } catch {
      progress.textContent = "Nie udało się usunąć danych sesji.";
    }
  });
}
