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
import { dataTable, empty, fmt, heatmap, legend, lineChart, type LinePoint, segmentedBar, sparkline, volumeBar } from "./charts.ts";

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

/** Segment order validated for colour-blind and normal-vision separation: green … red at the ends. */
const MIX: { key: Verdict; label: string; color: string }[] = [
  { key: "confirmed", label: "Potwierdzone", color: "var(--ok-bar)" },
  { key: "not_verifiable", label: "Nie podlega weryfikacji", color: "var(--op-bar)" },
  { key: "misleading", label: "Wprowadzające w błąd", color: "var(--mis2-bar)" },
  { key: "insufficient_evidence", label: "Brak dowodów", color: "var(--unk-bar)" },
  { key: "false", label: "Fałszywe", color: "var(--bad-bar)" },
];
const VERDICT_SHORT = Object.fromEntries(MIX.map((m) => [m.key, m.label])) as Record<Verdict, string>;
const CHANNEL: Record<string, string> = { web: "Strona", discord: "Discord", whatsapp: "WhatsApp", messenger: "Messenger", api: "API" };

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
      gate.hidden = true;
      content.hidden = false;
      return render(sampleAnalytics(range));
    }
    if (!token) {
      content.hidden = true;
      gate.hidden = false;
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
        content.hidden = true;
        gate.hidden = false;
        gateError.textContent = "Nieprawidłowy klucz.";
        gateError.hidden = false;
        return syncControls();
      }
      if (res.status === 404) return showNotice("Panel jest wyłączony na serwerze: ustaw ADMIN_TOKEN w API.");
      if (!res.ok) return showNotice(`API zwróciło błąd ${res.status}.`);
      gate.hidden = true;
      content.hidden = false;
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

  function render(r: AnalyticsReport) {
    content.classList.remove("is-loading");
    if (!r.sample && (r.range === "90d" || r.range === "1y")) {
      showNotice("Dane rzeczywiste sięgają 30 dni wstecz (retencja logów).");
    }
    renderKpis(r);
    renderVolume(r);
    heatmap($("heatmap"), r.heatmap);
    renderTopics(r);
    renderMix(r);
    renderTopClaims(r);
    renderIntegrity(r);
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

  function renderKpis(r: AnalyticsReport) {
    const k = r.kpis;
    const sec = (ms: number) => `${(ms / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s`;
    const usd = (v: number) => `$${v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const tile = (label: string, value: string, d: HTMLElement) =>
      h("article", { class: "kpi" }, h("h3", { class: "kpi-label" }, label), h("p", { class: "kpi-value" }, value), d);
    $("kpis").replaceChildren(
      tile("Sprawdzenia", fmt(k.checks.value), delta(k.checks.value, k.checks.prev)),
      tile("Sprawdzone zdania", fmt(k.claims.value), delta(k.claims.value, k.claims.prev)),
      tile("Mediana czasu odpowiedzi", k.median_latency_ms.value ? sec(k.median_latency_ms.value) : "–", delta(k.median_latency_ms.value, k.median_latency_ms.prev, true)),
      tile("Koszt 100 sprawdzeń", usd(k.cost_per_100_usd.value), delta(k.cost_per_100_usd.value, k.cost_per_100_usd.prev, true)),
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
    if (!r.topics.some((t) => t.claims)) return host.replaceChildren(empty());
    const max = Math.max(...r.topics.map((t) => t.claims));
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
            h("th", { scope: "col" }, "Temat"),
            h("th", { scope: "col", class: "hide-sm" }, "Trend"),
            h("th", { scope: "col" }, "Zmiana"),
            h("th", { scope: "col" }, "Zdania"),
          ),
        ),
        h(
          "tbody",
          {},
          ...r.topics.map((t, i) =>
            h(
              "tr",
              {},
              h("td", { class: "num muted" }, String(i + 1)),
              h("th", { scope: "row" }, t.label),
              h("td", { class: "hide-sm" }, sparkline(t.spark, `${t.label}: trend w 12 odcinkach okresu`)),
              h("td", {}, growth(t.growth)),
              h("td", {}, volumeBar(t.claims, max)),
            )
          ),
        ),
      ),
    );
  }

  function renderMix(r: AnalyticsReport) {
    const host = $("mix");
    const rows = r.topics.filter((t) => t.topic !== "other" && MIX.some((m) => t.verdicts[m.key]));
    if (!rows.length) return host.replaceChildren(empty("Brak ocen w tym okresie"));
    const total = (t: (typeof rows)[number]) => MIX.reduce((s, m) => s + t.verdicts[m.key], 0);
    host.replaceChildren(
      legend(MIX.map((m) => ({ label: m.label, color: m.color }))),
      h(
        "div",
        { class: "mix-rows" },
        ...rows.map((t) =>
          h(
            "div",
            { class: "mix-row" },
            h("div", { class: "mix-head" }, h("span", {}, t.label), h("span", { class: "muted" }, `${fmt(total(t))} ocen`)),
            segmentedBar(MIX.map((m) => ({ key: m.key, label: m.label, value: t.verdicts[m.key], color: m.color })), t.label),
          )
        ),
      ),
      dataTable(
        "Tabela danych",
        ["Temat", ...MIX.map((m) => m.label), "Awarie źródeł"],
        rows.map((t) => [t.label, ...MIX.map((m) => fmt(t.verdicts[m.key])), fmt(t.system_states)]),
      ),
    );
  }

  function renderTopClaims(r: AnalyticsReport) {
    const host = $("top-claims");
    if (!r.top_claims.length) return host.replaceChildren(empty("Żadne twierdzenie nie powtórzyło się"));
    host.replaceChildren(
      h(
        "ol",
        { class: "claims" },
        ...r.top_claims.map((c) =>
          h(
            "li",
            {},
            h("p", { class: "claim-q" }, c.text),
            h(
              "p",
              { class: "claim-meta" },
              c.verdict
                ? h("span", { class: `mini-pill tone-${c.verdict}` }, icon(c.verdict, "sm"), VERDICT_SHORT[c.verdict])
                : null,
              h("span", {}, c.label),
              h("span", {}, `${fmt(c.count)}×`),
            ),
          )
        ),
      ),
    );
  }

  function renderIntegrity(r: AnalyticsReport) {
    const i = r.integrity;
    const facts = Math.max(1, r.kpis.claims.value - i.opinions);
    const row = (value: number, label: string, note?: string) =>
      h("li", {}, h("strong", { class: "int-value" }, fmt(value)), h("span", {}, label, note ? h("span", { class: "muted" }, ` · ${note}`) : null));
    const totalChecks = Math.max(1, r.kpis.checks.value);
    $("integrity").replaceChildren(
      h(
        "ul",
        { class: "integrity" },
        row(i.injection_detected, "zablokowanych prób wstrzyknięcia poleceń"),
        row(i.pii_redacted, "pytań z zamaskowanymi danymi osobowymi"),
        row(i.abstained, "uczciwych „brak dowodów”", `${Math.round((i.abstained / facts) * 100)}% faktów`),
        row(i.context_matches, "zdań podobnych do znanych przekazów", "EUvsDisinfo"),
        row(i.opinions, "opinii bez oceny prawdziwości"),
        row(i.system_states, "awarii źródeł pokazanych jako stan, nie werdykt"),
      ),
      ...(r.channels.length
        ? [h(
          "p",
          { class: "channels" },
          h("span", { class: "muted" }, "Kanały: "),
          r.channels.map((c) => `${CHANNEL[c.channel] ?? c.channel} ${Math.round((c.checks / totalChecks) * 100)}%`).join(" · "),
        )]
        : []),
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
  $("gate-sample").addEventListener("click", () => setSample(true));
  logout.addEventListener("click", () => {
    token = null;
    store.set(TOKEN_KEY, null, sessionStorage);
    load();
  });

  load();
}

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
