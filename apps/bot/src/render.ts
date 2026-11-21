/**
 * CheckResponse → the short chat form (product/response-contract.md, messaging-bot.md step 7).
 *   1. The demo banner first whenever `meta.mode === "mock"` or `warnings[0].type === "demo_data"`.
 *   2. A request-level system state is a notice, never a verdict.
 *   3. Each claim: verdict label or system state, evidence strength, explanation, what is missing,
 *      warnings, and up to 3 "Sprawdź sam" links.
 *   4. Escalation, when recommended, says exactly "Rekomendujemy przekazanie do weryfikacji przez
 *      człowieka", never "przekazano".
 *   5. One limitations line ("nie wykrywamy deepfake'ów" for screenshots), then the footer.
 * Claims that don't fit the platform limit are counted, never cut in half.
 *
 * Every string from the response goes through sanitizeText; the only links are https citation URLs
 * and the web app URL. Output is the platform's native text, posted raw (the SDK's markdown
 * conversion wraps WhatsApp links in <>, see the prototype findings).
 */
import type { CheckResponse, ClaimResult } from "@prawdowid/core/types";
import { LIMITS, MAX_REPLY_CHARS, type Surface } from "./config.ts";
import { safeUrl, sanitizeText } from "./sanitize.ts";

export const ESCALATION_TEXT = "Rekomendujemy przekazanie do weryfikacji przez człowieka";
export const FAILURE_TEXT = "Nie mogliśmy wykonać sprawdzenia. To nie jest ocena treści.";

const VERDICT_ICON: Record<string, string> = {
  confirmed: "✅",
  false: "❌",
  misleading: "⚠️",
  insufficient_evidence: "❔",
  not_verifiable: "💬",
};
const VERDICT_LABEL: Record<string, string> = {
  confirmed: "potwierdzone",
  false: "fałszywe",
  misleading: "wprowadzające w błąd",
  insufficient_evidence: "brak wystarczających dowodów",
  not_verifiable: "nie podlega weryfikacji",
};
const STRENGTH_PL: Record<string, string> = { high: "wysoka", medium: "średnia", low: "niska" };
const KNOWN_REQUEST_STATES = new Set([
  "needs_clarification",
  "out_of_scope",
  "not_a_claim",
  "input_rejected",
  "rate_limited",
  "technical_error",
]);

interface Fmt {
  bold(s: string): string;
  link(url: string): string;
}

const FORMATS: Record<Surface, Fmt> = {
  // Links as <url> are never previewed on Discord.
  discord: { bold: (s) => `**${s}**`, link: (u) => `<${u}>` },
  whatsapp: { bold: (s) => `*${s}*`, link: (u) => u },
  messenger: { bold: (s) => s, link: (u) => u },
  console: { bold: (s) => s, link: (u) => u },
};

const PRIVACY_POINTER: Record<Surface, string> = {
  discord: "Prywatność: /pomoc",
  whatsapp: "Prywatność: napisz pomoc",
  messenger: "Prywatność: napisz pomoc",
  console: "Prywatność: napisz pomoc",
};

export interface RenderOptions {
  surface: Surface;
  webUrl: string | null;
  maxChars?: number;
}

function footer(o: RenderOptions): string {
  const web = o.webUrl ? safeUrl(o.webUrl) : null;
  const f = FORMATS[o.surface];
  return [web ? `Pełny wynik i opis metody: ${f.link(web)}` : null, PRIVACY_POINTER[o.surface]]
    .filter(Boolean)
    .join(" · ");
}

function isDemo(res: CheckResponse): boolean {
  return res.meta.mode === "mock" || res.warnings[0]?.type === "demo_data";
}

function demoBanner(f: Fmt): string {
  return `🧪 ${f.bold("DANE DEMO")}: to nie jest prawdziwe sprawdzenie, odpowiedź jest przykładowa.`;
}

function renderClaim(c: ClaimResult, n: number, f: Fmt): string {
  const lines: string[] = [];
  const verdict = c.verdict && VERDICT_LABEL[c.verdict] ? c.verdict : null;
  if (verdict) {
    const label = VERDICT_LABEL[verdict].toUpperCase();
    const strength = c.strength && STRENGTH_PL[c.strength.level] ? ` · siła dowodów: ${STRENGTH_PL[c.strength.level]}` : "";
    lines.push(`${VERDICT_ICON[verdict]} ${f.bold(`${n}. ${label}`)}${strength}`);
  } else {
    // A claim-level system state (or an unknown value): a notice, never a verdict.
    const msg = sanitizeText(c.system_message, 200) || "Tego twierdzenia nie udało się sprawdzić.";
    lines.push(`ℹ️ ${f.bold(`${n}. Nie sprawdzono`)}: ${msg}`);
  }
  lines.push(`„${sanitizeText(c.text, 300)}”`);
  const explanation = sanitizeText(c.explanation, 400);
  if (explanation) lines.push(`Nasza ocena: ${explanation.replace(/^Nasza ocena:\s*/i, "")}`);
  const missing = sanitizeText(c.missing, 250);
  if (missing) lines.push(`Czego nie ustaliliśmy: ${missing}`);
  for (const w of c.warnings) {
    const t = sanitizeText(w.text, 200);
    if (t) lines.push(`⚠️ ${t}`);
  }
  const links = c.citations
    .map((s) => ({ url: safeUrl(s.url), publisher: sanitizeText(s.publisher, 80), date: sanitizeText(s.published_at, 20) }))
    .filter((s): s is { url: string; publisher: string; date: string } => s.url !== null)
    .slice(0, LIMITS.maxCitationsPerClaim);
  if (links.length) {
    lines.push("Sprawdź sam:");
    for (const s of links) lines.push(`• ${s.publisher || "źródło"}${s.date ? ` (${s.date})` : ""}: ${f.link(s.url)}`);
  }
  return lines.join("\n");
}

function limitationsLine(res: CheckResponse): string {
  const parts = ["sprawdzamy tylko twierdzenia o faktach", "nie oceniamy opinii"];
  if (res.input.type === "image") parts.push("nie wykrywamy deepfake'ów");
  return `Ograniczenia: ${parts.join(", ")}.`;
}

function fit(blocks: string[], max: number): string {
  const out = blocks.join("\n\n");
  return out.length <= max ? out : `${out.slice(0, max - 1)}…`;
}

export function renderResponse(res: CheckResponse, o: RenderOptions): string {
  const f = FORMATS[o.surface];
  const max = o.maxChars ?? MAX_REPLY_CHARS[o.surface];
  const head: string[] = [];
  if (isDemo(res)) head.push(demoBanner(f));

  // Request-level system state (or a status this bot doesn't know yet): one notice, no claims.
  if (res.status !== "ok" && res.status !== "partial") {
    const title = KNOWN_REQUEST_STATES.has(res.status) ? sanitizeText(res.system_message?.title, 120) : "";
    const text = KNOWN_REQUEST_STATES.has(res.status) ? sanitizeText(res.system_message?.text, 500) : "";
    head.push(title || text ? `ℹ️ ${f.bold(title || "Informacja")}\n${text}`.trim() : `ℹ️ ${FAILURE_TEXT}`);
    return fit([...head, footer(o)], max);
  }

  if (res.status === "partial") head.push("ℹ️ Część twierdzeń sprawdziliśmy, części nie (szczegóły niżej).");
  const title = sanitizeText(res.input.title, 150);
  if (title) head.push(`Materiał: ${title}`);
  const summary = sanitizeText(res.summary.text, 200);
  if (summary) head.push(summary);
  for (const w of res.warnings) {
    if (w.type === "demo_data") continue;
    const t = sanitizeText(w.text, 200);
    if (t) head.push(`⚠️ ${t}`);
  }

  const tail: string[] = [];
  if (res.escalation.state === "recommended") tail.push(`👤 ${ESCALATION_TEXT}.`);
  tail.push(limitationsLine(res));
  tail.push(footer(o));

  const blocks = [...head];
  const reserve = tail.join("\n\n").length + 80; // room for the tail and the "…i N kolejnych" line
  let shown = 0;
  for (const [i, c] of res.claims.entries()) {
    const block = renderClaim(c, i + 1, f);
    if ([...blocks, block].join("\n\n").length + reserve > max && shown > 0) break;
    blocks.push(block);
    shown++;
  }
  const hidden = res.claims.length - shown;
  if (hidden > 0) {
    blocks.push(`…i jeszcze ${hidden} ${hidden === 1 ? "twierdzenie" : "twierdzenia"}${o.webUrl ? ", pełny wynik w aplikacji" : ""}.`);
  }
  return fit([...blocks, ...tail], max);
}

/** The guaranteed reply: any failure, timeout or invalid response. A system message, never a verdict. */
export function renderFailure(o: RenderOptions): string {
  return [`ℹ️ ${FORMATS[o.surface].bold(FAILURE_TEXT)}`, "Spróbuj ponownie za chwilę.", footer(o)].join("\n");
}

const LOCAL_TEXT = {
  unsupported_file: "Sprawdzamy tekst, linki i zrzuty ekranu (JPG, PNG, WebP). Filmów, nagrań i innych plików jeszcze nie.",
  image_too_large: "To zdjęcie jest za duże (maks. 5 MB). Wyślij mniejszy zrzut ekranu.",
  not_an_image: "Ten plik nie jest obrazem JPG, PNG ani WebP. Wyślij zrzut ekranu w jednym z tych formatów.",
  image_fetch_failed: "Nie udało się pobrać obrazu. Spróbuj wysłać go jeszcze raz.",
  empty: "Dodaj tekst albo link w polu „tresc” lub obraz w polu „obraz”.",
  demo_unavailable: "Scenariusze „demo:” działają tylko w trybie demonstracyjnym. Wyślij prawdziwy tekst do sprawdzenia.",
} as const;
export type LocalText = keyof typeof LOCAL_TEXT;

export function renderLocal(reason: LocalText, o: RenderOptions): string {
  return `ℹ️ ${LOCAL_TEXT[reason]}`;
}

export function renderDeleted(r: { ok: boolean; checks: number }, o: RenderOptions): string {
  if (!r.ok) return `ℹ️ Nie udało się usunąć danych. Spróbuj ponownie za chwilę.\n${footer(o)}`;
  const what = r.checks > 0
    ? `🗑️ Usunęliśmy ${r.checks} zapisanych sprawdzeń (liczba przybliżona).`
    : "🗑️ Nie znaleźliśmy zapisanych sprawdzeń.";
  return [
    what,
    "Twoje wiadomości zostają w historii czatu w aplikacji: tego nie możemy usunąć.",
    "Licznik dziennego limitu wygasa sam w ciągu 24 godzin.",
  ].join("\n");
}

/** /pomoc: what the bot does, plus the privacy notice (GDPR Art. 13; messaging-bot.md). */
export function renderHelp(o: RenderOptions & { mode: "live" | "mock" | "unknown"; controller: string | null }): string {
  const f = FORMATS[o.surface];
  const how = o.surface === "discord"
    ? "Użyj /sprawdz: wpisz tekst albo link w polu „tresc” albo dodaj zrzut ekranu w polu „obraz”. /usun-dane usuwa Twoje zapisane sprawdzenia."
    : "Wyślij mi tekst, link do artykułu albo zrzut ekranu (JPG, PNG, WebP). Napisz „usuń dane”, żeby usunąć swoje zapisane sprawdzenia.";
  const web = o.webUrl ? safeUrl(o.webUrl) : null;
  return [
    `👋 ${f.bold("Prawdowid")} sprawdza twierdzenia o faktach w oparciu o prawdziwe źródła i pokazuje linki, żebyś mógł sprawdzić sam.`,
    how,
    "Nie oceniamy opinii i nie wykrywamy deepfake'ów.",
    ...(o.mode === "mock"
      ? [o.surface === "discord"
        ? "🧪 Bot działa teraz w trybie demonstracyjnym: odpowiedzi są przykładowe. Wybierz przykład w /demo albo wpisz np. „demo:false” w /sprawdz."
        : "🧪 Bot działa teraz w trybie demonstracyjnym: odpowiedzi są przykładowe. Spróbuj np. „demo:false” albo „demo:mixed”."]
      : []),
    "",
    f.bold("Prywatność"),
    `• Administrator: ${o.controller ?? "zespół Prawdowid (kontakt zostanie uzupełniony)"}.`,
    "• Przetwarzamy treść, którą wysyłasz do sprawdzenia, i pseudonim (skrót Twojego identyfikatora, nie numer ani nazwę). Obrazy analizujemy, ale ich nie zapisujemy.",
    "• Cel i podstawa: sprawdzenie wiadomości na Twoją prośbę, prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO). Dane są ograniczone do minimum.",
    "• Nie wysyłaj danych wrażliwych: o zdrowiu, poglądach politycznych ani danych innych osób.",
    "• Zapisane sprawdzenia przechowujemy 30 dni. „usuń dane” usuwa je wcześniej (prawo do usunięcia i sprzeciwu).",
    "• Podmioty przetwarzające: platforma czatu, Vercel, dostawca modelu językowego (część z nich to firmy z USA, przekazanie na podstawie ich warunków transferu).",
    "• Masz prawo wnieść skargę do Prezesa UODO.",
    ...(web ? [`Więcej: ${f.link(web)}`] : []),
  ].join("\n");
}
