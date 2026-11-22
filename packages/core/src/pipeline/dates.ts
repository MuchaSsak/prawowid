/**
 * Dates without a year, and the reference date they are filled from (verification-pipeline §2).
 * The model copies a date as written ("16 listopada"); code fills the year, never the model.
 * Rule (user, 2026-11-21): the latest such date on or before the reference date; the nearest one
 * after it only when the material clearly points to the future ("zaplanowane na", "odbędzie się").
 */
import { containsVerbatim } from "../guard/normalize.ts";
import type { CorpusStore } from "../store/types.ts";

export type ReferenceSource = "publication" | "original" | "submission";

export interface ReferenceDate {
  /** YYYY-MM-DD */
  date: string;
  source: ReferenceSource;
}

export interface ResolvedTime {
  /** Full date (YYYY-MM-DD), month (YYYY-MM), year (YYYY), the text unchanged, or "unknown". */
  time: string;
  /** True when code added a year the material did not state. */
  filledYear: boolean;
  /** Set when a relative expression ("wczoraj", "w zeszłym roku") was turned into a date: the original words. */
  relative?: string;
}

// Genitive ("16 listopada"), nominative ("listopad") and locative ("w listopadzie") forms.
const MONTHS: [number, string[]][] = [
  [1, ["stycznia", "styczeń", "styczen", "styczniu"]],
  [2, ["lutego", "luty", "lutym"]],
  [3, ["marca", "marzec", "marcu"]],
  [4, ["kwietnia", "kwiecień", "kwiecien", "kwietniu"]],
  [5, ["maja", "maj", "maju"]],
  [6, ["czerwca", "czerwiec", "czerwcu"]],
  [7, ["lipca", "lipiec", "lipcu"]],
  [8, ["sierpnia", "sierpień", "sierpien", "sierpniu"]],
  [9, ["września", "wrzesnia", "wrzesień", "wrzesien", "wrześniu", "wrzesniu"]],
  [10, ["października", "pazdziernika", "październik", "pazdziernik", "październiku", "pazdzierniku"]],
  [11, ["listopada", "listopad", "listopadzie"]],
  [12, ["grudnia", "grudzień", "grudzien", "grudniu"]],
];
const MONTH_OF = new Map(MONTHS.flatMap(([n, forms]) => forms.map((f) => [f, n] as const)));
const MONTH_RE = [...MONTH_OF.keys()].sort((a, b) => b.length - a.length).join("|");

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Year for a day and month: latest on/before the reference (past) or earliest on/after it (future). */
function fillDay(m: number, d: number, ref: string, future: boolean): string | null {
  const refYear = Number(ref.slice(0, 4));
  const step = future ? 1 : -1;
  // A few years cover 29 February; otherwise the first or second candidate wins.
  for (let i = 0; i <= 8; i++) {
    const y = refYear + step * i;
    if (!validDay(y, m, d)) continue;
    const candidate = iso(y, m, d);
    if (future ? candidate >= ref : candidate <= ref) return candidate;
  }
  return null;
}

function fillMonth(m: number, ref: string, future: boolean): string {
  const refYear = Number(ref.slice(0, 4));
  const refMonth = Number(ref.slice(5, 7));
  const y = future ? (m < refMonth ? refYear + 1 : refYear) : (m > refMonth ? refYear - 1 : refYear);
  return `${y}-${pad(m)}`;
}

/** How far back "ostatnio" and "niedawno" reach (user, 2026-11-21). */
export const RECENT_DAYS = 30;

const addDaysIso = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Relative expressions resolved against the reference date (the date the material speaks from). */
function relativeTime(t: string, ref: string): string | null {
  const y = Number(ref.slice(0, 4));
  const m = Number(ref.slice(5, 7));
  const has = (re: RegExp) => re.test(t);
  // "Ostatnio", "niedawno": a window of RECENT_DAYS before the reference date (user, 2026-11-21),
  // written as an ISO interval "start/end" (parsePeriod reads its end).
  if (has(/(?<![\p{L}])(ostatnio|niedawno|ostatnimi\s+czasy|w\s+ostatnich\s+dniach|w\s+ostatnim\s+czasie)(?![\p{L}])/u)) {
    return `${addDaysIso(ref, -RECENT_DAYS)}/${ref}`;
  }
  if (has(/(?<![\p{L}])przedwczoraj(?![\p{L}])/u)) return addDaysIso(ref, -2);
  if (has(/(?<![\p{L}])wczoraj(?![\p{L}])/u)) return addDaysIso(ref, -1);
  if (has(/(?<![\p{L}])(dziś|dzis|dzisiaj)(?![\p{L}])/u)) return ref;
  if (has(/(?<![\p{L}])pojutrze(?![\p{L}])/u)) return addDaysIso(ref, 2);
  if (has(/(?<![\p{L}])jutro(?![\p{L}])/u)) return addDaysIso(ref, 1);
  if (has(/(zeszł|ubiegł|poprzedni)\p{L}*\s+(rok|roku)|rok\s+temu/u)) return String(y - 1);
  if (has(/(przyszł|następn)\p{L}*\s+(rok|roku)/u)) return String(y + 1);
  if (has(/(tym|bieżącym|biezacym|obecnym|tego)\s+(rok|roku)/u)) return String(y);
  if (has(/(zeszł|ubiegł|poprzedni)\p{L}*\s+(miesiąc|miesiącu|miesiaca|miesiąca|miesiacu)/u)) {
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  }
  if (has(/(tym|bieżącym|biezacym|obecnym|tego)\s+(miesiąc|miesiącu|miesiąca|miesiacu|miesiaca)/u)) return ref.slice(0, 7);
  return null;
}

/**
 * Turns the model's `time_text` into the time a claim is checked against, in the ISO-like form the
 * statistics connectors read (parsePeriod: "YYYY", "YYYY-MM", "YYYY-MM-DD"):
 * - a stated year: "16 listopada 2024" → 2024-11-16, "listopad 2024" → 2024-11, "16.11.2024" → 2024-11-16;
 *   anything else with a year ("w 2024 roku", "2020-2024") passes through for parsePeriod;
 * - no year: "16 listopada", "16.11" and "w listopadzie" get the year from the reference date;
 * - relative words ("wczoraj", "w zeszłym roku", "w tym miesiącu") are resolved against it, and
 *   "ostatnio" / "niedawno" become the window "start/end" of the last RECENT_DAYS days;
 * - no text → "unknown"; unparsed text passes through unchanged.
 */
export function resolveTime(
  timeText: string | null,
  direction: "past" | "future",
  ref: ReferenceDate,
): ResolvedTime {
  const raw = (timeText ?? "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return { time: "unknown", filledYear: false };
  const t = raw.toLowerCase();
  const future = direction === "future";

  if (/(?<!\d)(19|20)\d{2}(?!\d)/.test(t)) {
    if (/^\d{4}(-\d{2}){0,2}$/.test(t)) return { time: raw, filledYear: false };
    const named = t.match(new RegExp(`(?<!\\d)(\\d{1,2})\\s*(${MONTH_RE})(?![\\p{L}])\\s*((?:19|20)\\d{2})(?!\\d)`, "u"));
    if (named) {
      const [y, m, d] = [Number(named[3]), MONTH_OF.get(named[2])!, Number(named[1])];
      if (validDay(y, m, d)) return { time: iso(y, m, d), filledYear: false };
    }
    const numeric = t.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./]((?:19|20)\d{2})(?!\d)/);
    if (numeric) {
      const [y, m, d] = [Number(numeric[3]), Number(numeric[2]), Number(numeric[1])];
      if (validDay(y, m, d)) return { time: iso(y, m, d), filledYear: false };
    }
    const month = t.match(new RegExp(`(?<![\\p{L}])(${MONTH_RE})(?![\\p{L}])\\s*((?:19|20)\\d{2})(?!\\d)`, "u"));
    if (month) return { time: `${month[2]}-${pad(MONTH_OF.get(month[1])!)}`, filledYear: false };
    return { time: raw, filledYear: false };
  }

  const rel = relativeTime(t, ref.date);
  if (rel) return { time: rel, filledYear: true, relative: raw };

  const named = t.match(new RegExp(`\\b(\\d{1,2})\\s*(${MONTH_RE})(?![\\p{L}])`, "u"));
  if (named) {
    const filled = fillDay(MONTH_OF.get(named[2])!, Number(named[1]), ref.date, future);
    if (filled) return { time: filled, filledYear: true };
  }
  const numeric = t.match(/\b(\d{1,2})[./](\d{1,2})\b(?![./]\d)/);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    if (m >= 1 && m <= 12) {
      const filled = fillDay(m, d, ref.date, future);
      if (filled) return { time: filled, filledYear: true };
    }
  }
  const monthOnly = t.match(new RegExp(`(?<![\\p{L}])(${MONTH_RE})(?![\\p{L}])`, "u"));
  if (monthOnly) return { time: fillMonth(MONTH_OF.get(monthOnly[1])!, ref.date, future), filledYear: true };
  return { time: raw, filledYear: false };
}

const DAY = /^\d{4}-\d{2}-\d{2}/;

/** Distinctive sentences of a pasted text: the longest ones of a sensible length. */
export function distinctiveSentences(text: string, max = 3): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 60 && s.length <= 300)
    .sort((a, b) => b.length - a.length)
    .slice(0, max);
}

/**
 * Option 3 (user, 2026-11-21): for material without a publication date, look for the original in our
 * corpus. A record counts only when it contains one of the distinctive sentences verbatim; the earliest
 * such publication is the original. Never asks the citizen. Errors and timeouts fall back silently.
 */
export async function findOriginalDate(
  texts: string[],
  corpus: CorpusStore,
  today: string,
  timeoutMs = 1500,
): Promise<string | null> {
  if (corpus.size() === 0) return null;
  // Corpus search is synchronous CPU work, so the timeout below can't interrupt it: cap the number of
  // searches and check the deadline between them (a recording with many turns must not block the instance).
  const sentences = texts.flatMap((t) => distinctiveSentences(t)).slice(0, 3);
  if (!sentences.length) return null;
  const deadline = Date.now() + timeoutMs;
  const search = (async () => {
    const dates: string[] = [];
    for (const s of sentences) {
      if (Date.now() > deadline) break;
      const records = await corpus.search([s], 5);
      for (const r of records) {
        if (r.published_at && DAY.test(r.published_at) && containsVerbatim(r.text, s)) {
          const d = r.published_at.slice(0, 10);
          if (d <= today) dates.push(d);
        }
      }
    }
    return dates.sort()[0] ?? null;
  })();
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([search, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Publication date of the material, else the original's date, else the submission date. */
export async function referenceDate(args: {
  publishedAt: string | null;
  texts: string[];
  corpus: CorpusStore;
  today: string;
}): Promise<ReferenceDate> {
  if (args.publishedAt && DAY.test(args.publishedAt)) {
    return { date: args.publishedAt.slice(0, 10), source: "publication" };
  }
  const original = await findOriginalDate(args.texts, args.corpus, args.today);
  if (original) return { date: original, source: "original" };
  return { date: args.today, source: "submission" };
}

export function formatDatePl(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return d ? `${d}.${m}.${y}` : isoDate;
}

/** The user-facing note for a filled year or an undated claim (warning `assumed_period`). */
export function periodNote(resolved: ResolvedTime, ref: ReferenceDate): string | null {
  const when = formatDatePl(ref.date);
  const basis = ref.source === "publication"
    ? `daty publikacji (${when})`
    : ref.source === "original"
    ? `daty publikacji oryginalnego tekstu (${when})`
    : `daty zgłoszenia (${when}); jeśli tekst jest starszy, wynik może być inny`;
  if (resolved.time === "unknown") {
    return `Twierdzenie nie podaje daty; porównujemy je z najnowszymi informacjami dostępnymi na dzień ${when}.`;
  }
  if (resolved.relative) {
    const t = resolved.time;
    const interval = t.match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
    const shown = interval
      ? `okres ${formatDatePl(interval[1])}–${formatDatePl(interval[2])}`
      : /^\d{4}-\d{2}-\d{2}$/.test(t)
      ? formatDatePl(t)
      : /^\d{4}-\d{2}$/.test(t)
      ? `${t.slice(5, 7)}.${t.slice(0, 4)}`
      : t;
    return `Tekst podaje czas względnie („${resolved.relative}”); przyjęliśmy ${shown} na podstawie ${basis}.`;
  }
  if (resolved.filledYear) {
    return `Tekst nie podaje roku; przyjęliśmy ${resolved.time.slice(0, 4)} na podstawie ${basis}.`;
  }
  return null;
}
