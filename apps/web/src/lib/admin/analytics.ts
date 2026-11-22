/**
 * Admin → Analityka. Real data: GET /api/v1/admin/analytics with the admin token (kept in
 * sessionStorage for this tab only). Sample data (switch or ?test=true): built in the browser by the
 * same buildAnalytics() over synthetic logs, no API call and no token needed (decision 011).
 */
import { ANALYTICS_RANGES, type AnalyticsRange, type AnalyticsReport, sampleAnalytics } from "@prawdowid/core/analytics";
import type { Verdict } from "@prawdowid/core/types";
import { h } from "../dom.ts";
import { icon } from "../render.ts";
import { drawRosettes } from "../rosette.ts";
import { dataTable, empty, fmt, heatmap, lineChart, type LinePoint, sparkline, volumeBar } from "./charts.ts";

const TOKEN_KEY = "prawdowid.admin-token";
const RANGE_KEY = "prawdowid.admin-range";

const RANGE_PREV: Record<AnalyticsRange, string> = {
  "24h": "poprzednich 24 h",
  "7d": "poprzednich 7 dni",
  "30d": "poprzednich 30 dni",
  "90d": "poprzednich 90 dni",
  "1y": "poprzedniego roku",
};
const BUCKET_TEXT = { hour: "na godzinę", day: "na dzień", week: "na tydzień", month: "na miesiąc" } as const;

const VERDICT_SHORT: Record<Verdict, string> = {
  confirmed: "Potwierdzone",
  not_verifiable: "Nie podlega weryfikacji",
  misleading: "Wprowadzające w błąd",
  insufficient_evidence: "Brak dowodów",
  false: "Fałszywe",
};

const store = {
  get(k: string, s: Storage = localStorage) {
    try {
      return s.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null, s: Storage = localStorage) {
    try {
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    } catch { /* private mode */ }
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Sample reports are deterministic per hour (sample.ts), so one build per range and hour is enough:
// switching back to a range already seen is instant instead of re-running ~10k synthetic rows.
const sampleCache = new Map<string, AnalyticsReport>();
function sampleReport(range: AnalyticsRange): AnalyticsReport {
  const key = `${range}:${Math.floor(Date.now() / 3_600_000)}`;
  let r = sampleCache.get(key);
  if (!r) {
    if (sampleCache.size >= ANALYTICS_RANGES.length) sampleCache.clear();
    sampleCache.set(key, r = sampleAnalytics(range));
  }
  return r;
}

export function initAnalytics() {
  drawRosettes();
  const api = document.body.dataset.api ?? "http://localhost:8787";
  const url = new URL(location.href);
  let sample = url.searchParams.get("test") === "true";
  const saved = url.searchParams.get("range") ?? store.get(RANGE_KEY);
  let range: AnalyticsRange = (ANALYTICS_RANGES as readonly string[]).includes(saved ?? "") ? saved as AnalyticsRange : "7d";
  let token = store.get(TOKEN_KEY, sessionStorage);
  let request = 0;

  const content = $("content");
  const gate = $("gate");
  const gateForm = $<HTMLFormElement>("gate-form");
  const gateError = $("gate-error");
  const notice = $("notice");
  const sampleSwitch = $<HTMLButtonElement>("sample-switch");
  const testBar = $("test-bar");
  const logout = $<HTMLButtonElement>("logout");

  // Locked = the key screen covers the whole page; only the key or sample data opens the panel.
  const lock = (on: boolean) => {
    gate.hidden = !on;
    content.hidden = on;
    document.body.classList.toggle("is-locked", on);
  };

  const syncUrl = () => {
    const u = new URL(location.href);
    if (sample) u.searchParams.set("test", "true");
    else u.searchParams.delete("test");
    u.searchParams.set("range", range);
    history.replaceState(null, "", u);
  };

  const syncControls = () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
      b.setAttribute("aria-pressed", String(b.dataset.range === range));
    }
    sampleSwitch.setAttribute("aria-checked", String(sample));
    testBar.hidden = !sample;
    document.body.classList.toggle("has-test-bar", sample);
    logout.hidden = sample || !token;
  };

  async function load() {
    syncControls();
    syncUrl();
    const id = ++request;
    notice.hidden = true;
    if (sample) {
      lock(false);
      return render(sampleReport(range));
    }
    if (!token) {
      lock(true);
      gateError.hidden = true;
      return;
    }
    content.classList.add("is-loading");
    try {
      const res = await fetch(`${api}/api/v1/admin/analytics?range=${range}`, { headers: { Authorization: `Bearer ${token}` } });
      if (id !== request) return;
      if (res.status === 401) {
        token = null;
        store.set(TOKEN_KEY, null, sessionStorage);
        lock(true);
        gateError.textContent = "Nieprawidłowy klucz.";
        gateError.hidden = false;
        return syncControls();
      }
      if (res.status === 404) return showNotice("Panel jest wyłączony na serwerze: ustaw ADMIN_TOKEN w API.");
      if (!res.ok) return showNotice(`API zwróciło błąd ${res.status}.`);
      lock(false);
      render(await res.json() as AnalyticsReport);
    } catch {
      if (id === request) showNotice("Nie udało się połączyć z API. Możesz włączyć dane przykładowe.");
    } finally {
      if (id === request) content.classList.remove("is-loading");
    }
  }

  function showNotice(text: string) {
    notice.textContent = text;
    notice.hidden = false;
  }

  let current: AnalyticsReport | null = null;

  function render(r: AnalyticsReport) {
    current = r;
    content.classList.remove("is-loading");
    // Replay the short staggered entry on every new report (first load, range or sample switch).
    content.classList.remove("is-entering");
    void content.offsetWidth;
    content.classList.add("is-entering");
    if (!r.sample && (r.range === "90d" || r.range === "1y")) {
      showNotice("Dane rzeczywiste sięgają 30 dni wstecz (retencja logów).");
    }
    renderKpis(r);
    renderVolume(r);
    heatmap($("heatmap"), r.heatmap);
    renderTopics(r);
  }

  function delta(value: number, prev: number, lowerIsBetter = false): HTMLElement {
    if (!prev) return h("p", { class: "kpi-delta" }, `brak danych z ${RANGE_PREV[range]}`);
    const change = (value - prev) / prev;
    const pct = Math.round(Math.abs(change) * 100);
    // Neutral ink, an arrow carries the direction: verdict colours stay reserved for verdicts.
    const arrow = pct === 0 ? "–" : change > 0 ? "▲" : "▼";
    const better = pct !== 0 && (change > 0) !== lowerIsBetter;
    return h(
      "p",
      { class: `kpi-delta${pct === 0 ? "" : better ? " is-up" : " is-down"}` },
      h("span", { "aria-hidden": "true" }, arrow),
      ` ${pct}% wobec ${RANGE_PREV[range]}`,
    );
  }

  /** Change of a share in percentage points ("pp"), neutral ink: a share is not better up or down. */
  function pointsDelta(value: number, prev: number): HTMLElement {
    if (!prev) return h("p", { class: "kpi-delta" }, `brak danych z ${RANGE_PREV[range]}`);
    const pp = Math.round((value - prev) * 100);
    const arrow = pp === 0 ? "–" : pp > 0 ? "▲" : "▼";
    return h("p", { class: "kpi-delta" }, h("span", { "aria-hidden": "true" }, arrow), ` ${Math.abs(pp)} pp wobec ${RANGE_PREV[range]}`);
  }

  function renderKpis(r: AnalyticsReport) {
    const k = r.kpis;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const sec = (ms: number) => `${(ms / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s`;
    const tile = (label: string, value: string, d: HTMLElement) =>
      h("article", { class: "kpi" }, h("h3", { class: "kpi-label" }, label), h("p", { class: "kpi-value" }, value), d);
    $("kpis").replaceChildren(
      tile("Sprawdzenia", fmt(k.checks.value), delta(k.checks.value, k.checks.prev)),
      tile("Fałszywe lub mylące", pct(k.false_share.value), pointsDelta(k.false_share.value, k.false_share.prev)),
      tile("Mediana czasu odpowiedzi", k.median_latency_ms.value ? sec(k.median_latency_ms.value) : "–", delta(k.median_latency_ms.value, k.median_latency_ms.prev, true)),
    );
  }

  function tickFor(key: string, i: number, n: number): string {
    if (r_bucket === "hour") {
      const hh = key.slice(11, 13);
      if (range === "24h") return Number(hh) % 4 === 0 ? `${hh}:00` : "";
      if (hh !== "00") return "";
      const [, m, d] = key.slice(0, 10).split("-");
      return `${Number(d)}.${m}`;
    }
    const every = Math.ceil(n / 6);
    if (i % every !== 0) return "";
    if (r_bucket === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]} ’${key.slice(2, 4)}`;
    const [, m, d] = key.replace("W", "").split("-");
    return `${Number(d)}.${m}`;
  }
  let r_bucket: AnalyticsReport["bucket"] = "hour";

  function renderVolume(r: AnalyticsReport) {
    r_bucket = r.bucket;
    $("volume-sub").textContent = `Sprawdzenia ${BUCKET_TEXT[r.bucket]}, czas polski`;
    const points: LinePoint[] = r.volume.map((v, i) => ({
      label: v.label,
      tick: tickFor(v.key, i, r.volume.length),
      value: v.checks,
      partial: v.partial,
      extra: [{ value: fmt(v.claims), label: "zdań" }],
    }));
    const host = $("volume");
    const chart = h("div", { class: "chart-host" });
    host.replaceChildren(
      chart,
      dataTable("Tabela danych", ["Okres", "Sprawdzenia", "Zdania"], r.volume.map((v) => [v.partial ? `${v.label} (niepełny)` : v.label, fmt(v.checks), fmt(v.claims)])),
    );
    lineChart(chart, points, "Sprawdzenia");
  }

  function renderTopics(r: AnalyticsReport) {
    const host = $("topics");
    if (!r.top_claims.length) return host.replaceChildren(empty("Żadne twierdzenie nie powtórzyło się"));
    const max = Math.max(...r.top_claims.map((c) => c.count));
    const slices = sliceLabels(r);
    const growth = (g: number | null) => {
      if (g === null) return h("span", { class: "growth" }, "nowy");
      const pct = Math.round(g * 100);
      return h("span", { class: `growth${pct > 0 ? " is-up" : ""}` }, `${pct > 0 ? "▲" : pct < 0 ? "▼" : "–"} ${Math.abs(pct)}%`);
    };
    host.replaceChildren(
      h(
        "table",
        { class: "rank-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col", class: "num" }, "#"),
            h("th", { scope: "col" }, "Twierdzenie"),
            h("th", { scope: "col" }, "Werdykt"),
            h("th", { scope: "col", class: "hide-sm" }, "Trend"),
            h("th", { scope: "col", class: "hide-sm" }, "Zmiana"),
            h("th", { scope: "col" }, "Sprawdzenia"),
          ),
        ),
        h(
          "tbody",
          {},
          ...r.top_claims.map((c, i) =>
            h(
              "tr",
              { style: `--row:${i}` },
              h("td", { class: "num muted" }, String(i + 1)),
              h("th", { scope: "row", class: "claim-cell" }, c.text),
              h(
                "td",
                {},
                c.verdict
                  ? h("span", { class: `mini-pill tone-${c.verdict}`, title: VERDICT_SHORT[c.verdict] }, icon(c.verdict, "sm"), h("span", { class: "pill-text" }, VERDICT_SHORT[c.verdict]))
                  : h("span", { class: "muted" }, "–"),
              ),
              h("td", { class: "hide-sm" }, sparkline(c.spark, `${c.text}: trend w 12 odcinkach okresu`, slices)),
              h("td", { class: "hide-sm" }, growth(c.growth)),
              h("td", {}, volumeBar(c.count, max)),
            )
          ),
        ),
      ),
    );
  }

  // ── controls ──
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
    b.addEventListener("click", () => {
      range = b.dataset.range as AnalyticsRange;
      store.set(RANGE_KEY, range);
      load();
    });
  }
  const setSample = (on: boolean) => {
    sample = on;
    load();
  };
  sampleSwitch.addEventListener("click", () => setSample(!sample));
  $("test-off").addEventListener("click", () => setSample(false));
  $("refresh").addEventListener("click", () => load());
  gateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = (new FormData(gateForm).get("token") ?? "").toString().trim();
    if (!value) return;
    token = value;
    store.set(TOKEN_KEY, value, sessionStorage);
    gateForm.reset();
    load();
  });
  const exportMenu = $<HTMLDetailsElement>("export");
  for (const b of exportMenu.querySelectorAll<HTMLButtonElement>("[data-export]")) {
    b.addEventListener("click", () => {
      exportMenu.open = false;
      if (!current) return showNotice("Brak danych do eksportu.");
      const kind = b.dataset.export as "csv" | "json";
      const name = `prawdomat-analityka-${current.range}${current.sample ? "-przyklad" : ""}-${current.generated_at.slice(0, 10)}.${kind}`;
      if (kind === "json") download(name, JSON.stringify(current, null, 2), "application/json");
      else download(name, "﻿" + toCsv(current), "text/csv;charset=utf-8");
    });
  }
  document.addEventListener("click", (e) => {
    if (exportMenu.open && !exportMenu.contains(e.target as Node)) exportMenu.open = false;
  });
  exportMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") exportMenu.open = false;
  });
  $("gate-sample").addEventListener("click", () => setSample(true));
  logout.addEventListener("click", () => {
    token = null;
    store.set(TOKEN_KEY, null, sessionStorage);
    load();
  });

  load();
}

/** Names of the 12 equal slices of the report range, for the sparkline hover (Warsaw time). */
function sliceLabels(r: AnalyticsReport): string[] {
  const from = Date.parse(r.from);
  const step = (Date.parse(r.generated_at) - from) / 12;
  const day = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });
  return Array.from({ length: 12 }, (_, i) => {
    // Rounded to the full hour: the range ends "now", so raw edges carry odd minutes.
    const a = Math.round((from + i * step) / 3_600_000) * 3_600_000;
    const b = Math.round((from + (i + 1) * step) / 3_600_000) * 3_600_000;
    if (step <= 6 * 3_600_000) return `${time.format(a)}–${time.format(b)}`;
    if (step < 86_400_000) return `${day.format(a)}, ${time.format(a)}–${time.format(b)}`;
    const da = day.format(a), db = day.format(b - 1);
    return da === db ? da : `${da} – ${db}`;
  });
}

function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One CSV file, sections separated by a blank line (Excel-friendly: BOM added by the caller, `;` separator). */
function toCsv(r: AnalyticsReport): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (head: string[], body: unknown[][]) => [head, ...body].map((row) => row.map(cell).join(";")).join("\r\n");
  const days = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];
  return [
    rows(["zakres", "od", "wygenerowano", "przykładowe"], [[r.range, r.from, r.generated_at, r.sample ? "tak" : "nie"]]),
    rows(["wskaźnik", "wartość", "poprzednio"], Object.entries(r.kpis).map(([k, v]) => [k, v.value, v.prev])),
    rows(["okres", "klucz", "sprawdzenia", "zdania", "niepełny"], r.volume.map((v) => [v.label, v.key, v.checks, v.claims, v.partial ? "tak" : ""])),
    rows(["twierdzenie", "werdykt", "sprawdzenia", "poprzednio", "zmiana"], r.top_claims.map((c) => [c.text, c.verdict ?? "", c.count, c.prev, c.growth ?? ""])),
    rows(["dzień", ...Array.from({ length: 24 }, (_, h) => `${h}:00`)], r.heatmap.map((row, i) => [days[i], ...row])),
  ].join("\r\n\r\n");
}

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
