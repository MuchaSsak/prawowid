/**
 * Admin → Źródła. Real data: GET/POST /api/v1/admin/sources and GET /api/v1/admin/sources/search
 * with the admin token (the same sessionStorage key as Analityka, this tab only). Sample data
 * (switch or ?test=true): an invented in-memory state, toggles and search run in the browser, no API
 * call and no token needed.
 */
import { h } from "../dom.ts";
import { drawRosettes } from "../rosette.ts";

type Kind = "route" | "corpus" | "publisher";
type Tier = "official" | "factcheck" | "media";

interface Source {
  key: string;
  kind: Kind;
  id: string;
  label: string;
  enabled: boolean;
  required?: boolean;
  records?: number;
  latest?: string | null;
  tier?: Tier;
  access?: string;
}
interface AuditEntry {
  at: string;
  key: string;
  enabled: boolean;
}
interface SourcesState {
  persistence: "kv" | "memory";
  revision: number;
  updated_at: string | null;
  sources: Source[];
  audit: AuditEntry[];
}
interface Hit {
  title: string;
  publisher: string;
  url: string;
  published_at: string | null;
  collection: string;
  excerpt: string;
}
interface SearchResult {
  ms: number;
  hits: Hit[];
}

const TOKEN_KEY = "prawdowid.admin-token";
const TIER: Record<Tier, string> = { official: "Urzędowe", factcheck: "Fact-checking", media: "Media" };
const SECTIONS: { kind: Kind; title: (n: number) => string }[] = [
  { kind: "route", title: () => "Trasy na żywo" },
  { kind: "corpus", title: (n) => `Korpus (${n} ${plural(n, "zbiór", "zbiory", "zbiorów")})` },
  { kind: "publisher", title: () => "Wydawcy" },
];

const nf = new Intl.NumberFormat("pl-PL");
const dayFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" });
const dayFmtUtc = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });

function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayFmtUtc.format(Date.parse(`${s}T00:00:00Z`));
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : dayFmt.format(t);
}
function fmtTime(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : timeFmt.format(t);
}
/** Case- and diacritics-insensitive, so "zrodla" finds "Źródła". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
/** Only http(s) links from the API become hrefs. */
function safeUrl(u: string): string | undefined {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : undefined;
  } catch {
    return undefined;
  }
}

const store = {
  get(k: string) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch { /* private mode */ }
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function initSources() {
  drawRosettes();
  const api = document.body.dataset.api ?? "http://localhost:8787";
  let sample = new URL(location.href).searchParams.get("test") === "true";
  let token = store.get(TOKEN_KEY);
  let state: SourcesState | null = null;
  let sampleState: SourcesState | null = null;
  let request = 0;
  let filter = "";
  let lastQuery = "";
  /** Toggles still waiting for the server: key → wanted value, laid over every state we receive. */
  const pending = new Map<string, boolean>();
  const rowErrors = new Map<string, string>();

  const content = $("content");
  const gate = $("gate");
  const gateForm = $<HTMLFormElement>("gate-form");
  const gateError = $("gate-error");
  const notice = $("notice");
  const persistNote = $("persist-note");
  const sampleSwitch = $<HTMLButtonElement>("sample-switch");
  const testBar = $("test-bar");
  const logout = $<HTMLButtonElement>("logout");
  const filterInput = $<HTMLInputElement>("filter");
  const searchForm = $<HTMLFormElement>("search-form");
  const searchOut = $("search-out");

  const lock = (on: boolean) => {
    gate.hidden = !on;
    content.hidden = on;
    document.body.classList.toggle("is-locked", on);
  };
  // While the lock covers the page the notice is hidden with it, so the message goes on the lock.
  const showNotice = (text: string) => {
    const el = document.body.classList.contains("is-locked") ? gateError : notice;
    el.textContent = text;
    el.hidden = false;
  };
  const syncControls = () => {
    sampleSwitch.setAttribute("aria-checked", String(sample));
    testBar.hidden = !sample;
    document.body.classList.toggle("has-test-bar", sample);
    logout.hidden = sample || !token;
    const u = new URL(location.href);
    if (sample) u.searchParams.set("test", "true");
    else u.searchParams.delete("test");
    history.replaceState(null, "", u);
  };
  const forgetToken = (message: string) => {
    token = null;
    store.set(TOKEN_KEY, null);
    state = null;
    lock(true);
    gateError.textContent = message;
    gateError.hidden = false;
    syncControls();
  };

  /** One API call with the key; maps the shared admin errors (401, 404, 429) for every caller. */
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (res.status === 401) forgetToken("Nieprawidłowy klucz.");
    if (res.status === 429) forgetToken("Za dużo nieudanych prób. Spróbuj za kilka minut.");
    if (!res.ok) throw new HttpError(res.status);
    return await res.json() as T;
  }

  async function load() {
    syncControls();
    const id = ++request;
    notice.hidden = true;
    pending.clear();
    rowErrors.clear();
    if (sample) {
      sampleState ??= sampleSources();
      lock(false);
      return render(sampleState, true);
    }
    if (!token) {
      lock(true);
      gateError.hidden = true;
      return;
    }
    content.classList.add("is-loading");
    try {
      const s = await call<SourcesState>("/api/v1/admin/sources");
      if (id !== request) return;
      lock(false);
      render(s, true);
    } catch (e) {
      if (id !== request) return;
      if (e instanceof HttpError) {
        if (e.status === 404) showNotice("Panel jest wyłączony na serwerze: ustaw ADMIN_TOKEN w API.");
        else if (e.status !== 401 && e.status !== 429) showNotice(`API zwróciło błąd ${e.status}.`);
      } else showNotice("Nie udało się połączyć z API. Możesz włączyć dane przykładowe.");
    } finally {
      if (id === request) content.classList.remove("is-loading");
    }
  }

  function render(s: SourcesState, entering = false) {
    state = { ...s, sources: s.sources.map((x) => (pending.has(x.key) ? { ...x, enabled: pending.get(x.key)! } : x)) };
    if (entering) {
      content.classList.remove("is-entering");
      void content.offsetWidth;
      content.classList.add("is-entering");
    }
    persistNote.hidden = state.persistence !== "memory";
    // Keep keyboard focus on the toggle that was just used: the lists are rebuilt below.
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
    for (const sec of SECTIONS) renderSection(sec.kind, sec.title);
    renderAudit();
    if (focusKey) content.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function renderSection(kind: Kind, title: (n: number) => string) {
    const all = state!.sources.filter((s) => s.kind === kind);
    const shown = filter ? all.filter((s) => fold(s.label).includes(filter) || fold(s.id).includes(filter)) : all;
    const on = all.filter((s) => s.enabled).length;
    $(`title-${kind}`).textContent = title(all.length);
    let sub = `Włączone: ${on} z ${all.length}`;
    if (filter) sub += ` · pasuje: ${shown.length}`;
    if (kind === "corpus" && state!.sources.some((s) => s.key === "route:corpus" && !s.enabled)) sub += " · cały korpus wyłączony w trasach";
    $(`sub-${kind}`).textContent = sub;
    const host = $(`list-${kind}`);
    if (!shown.length) return host.replaceChildren(h("p", { class: "chart-empty" }, all.length ? "Nic nie pasuje do filtra" : "Brak źródeł"));
    host.replaceChildren(h("ul", { class: "src-list" }, ...shown.map(row)));
  }

  function row(s: Source): HTMLElement {
    const labelId = `src-${s.key.replace(/[^a-z0-9]/gi, "-")}`;
    const meta: string[] = [];
    if (s.kind === "corpus") {
      // Several collections share one publisher label, so the id is what tells the rows apart.
      meta.push(s.id);
      if (typeof s.records === "number") meta.push(`${nf.format(s.records)} ${plural(s.records, "fragment", "fragmenty", "fragmentów")}`);
      meta.push(s.latest ? `do ${fmtDate(s.latest)}` : "bez dat");
    }
    if (s.kind === "publisher" && s.tier) meta.push(TIER[s.tier] ?? s.tier);
    if (s.kind === "route" && s.required) meta.push("wymagana");
    const error = rowErrors.get(s.key);
    return h(
      "li",
      { class: `src-row${s.enabled ? "" : " is-off"}` },
      h(
        "div",
        { class: "src-text" },
        h("span", { class: "src-label", id: labelId }, s.label),
        meta.length ? h("span", { class: "src-meta", title: s.access ? `Dostęp: ${s.access}` : undefined }, meta.join(" · ")) : null,
        s.required && !s.enabled ? h("span", { class: "src-warn" }, "Twierdzenia, które jej wymagają, będą oznaczone jako niesprawdzone.") : null,
        error ? h("span", { class: "src-error", role: "alert" }, error) : null,
      ),
      h(
        "button",
        {
          type: "button",
          class: "src-toggle",
          role: "switch",
          "aria-checked": String(s.enabled),
          "aria-labelledby": labelId,
          "aria-busy": pending.has(s.key) ? "true" : undefined,
          "data-key": s.key,
        },
        h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-thumb" })),
      ),
    );
  }

  function renderAudit() {
    const host = $("audit");
    const audit = state!.audit;
    if (!audit.length) return host.replaceChildren(h("p", { class: "chart-empty" }, "Brak zmian"));
    const labels = new Map(state!.sources.map((s) => [s.key, s]));
    const kindName: Record<Kind, string> = { route: "trasa", corpus: "korpus", publisher: "wydawca" };
    host.replaceChildren(
      h(
        "ul",
        { class: "audit-list" },
        ...audit.map((a) => {
          const src = labels.get(a.key);
          return h(
            "li",
            { class: "audit-row" },
            h("time", { class: "audit-time", datetime: a.at }, fmtTime(a.at)),
            h("span", { class: "audit-what" }, h("strong", {}, src?.label ?? a.key), src ? h("span", { class: "muted" }, ` (${kindName[src.kind]})`) : null),
            h("span", { class: `audit-state${a.enabled ? "" : " is-off"}` }, a.enabled ? "włączono" : "wyłączono"),
          );
        }),
      ),
    );
  }

  // ── toggles: optimistic, reverted with an inline error when the save fails ──
  async function toggle(key: string) {
    if (!state) return;
    const src = state.sources.find((s) => s.key === key);
    if (!src) return;
    const want = !src.enabled;
    pending.set(key, want);
    rowErrors.delete(key);
    render(state);
    try {
      const next = sample ? await sampleToggle(key, want) : await call<SourcesState>("/api/v1/admin/sources", { method: "POST", body: JSON.stringify({ key, enabled: want }) });
      pending.delete(key);
      render(next);
      if (lastQuery) runSearch(lastQuery, true);
    } catch (e) {
      pending.delete(key);
      if (e instanceof HttpError && (e.status === 401 || e.status === 429)) return;
      rowErrors.set(key, e instanceof HttpError ? (e.status === 400 ? "Serwer nie zna tego źródła." : `Nie zapisano (błąd ${e.status}).`) : "Nie zapisano: brak połączenia z API.");
      // Revert: the server state did not change, so put the old value back.
      render({ ...state, sources: state.sources.map((s) => (s.key === key ? { ...s, enabled: !want } : s)) });
    }
  }

  async function sampleToggle(key: string, enabled: boolean): Promise<SourcesState> {
    await new Promise((r) => setTimeout(r, 250));
    const s = sampleState!;
    const at = new Date().toISOString();
    sampleState = {
      ...s,
      revision: s.revision + 1,
      updated_at: at,
      sources: s.sources.map((x) => (x.key === key ? { ...x, enabled } : x)),
      audit: [{ at, key, enabled }, ...s.audit].slice(0, 50),
    };
    return sampleState;
  }

  // ── search test ──
  let searchId = 0;
  async function runSearch(q: string, quiet = false) {
    const id = ++searchId;
    lastQuery = q;
    if (!quiet) searchOut.replaceChildren(h("p", { class: "sub" }, "Szukam…"));
    try {
      const r = sample ? sampleSearch(q) : await call<SearchResult>(`/api/v1/admin/sources/search?q=${encodeURIComponent(q)}`);
      if (id !== searchId) return;
      renderHits(r);
    } catch (e) {
      if (id !== searchId) return;
      if (e instanceof HttpError && (e.status === 401 || e.status === 429)) return;
      searchOut.replaceChildren(h("p", { class: "src-error", role: "alert" }, e instanceof HttpError ? `Wyszukiwanie nie działa (błąd ${e.status}).` : "Brak połączenia z API."));
    }
  }

  function renderHits(r: SearchResult) {
    const head = h("p", { class: "sub", role: "status" }, `${r.hits.length} ${plural(r.hits.length, "wynik", "wyniki", "wyników")} · ${nf.format(Math.round(r.ms))} ms`);
    if (!r.hits.length) return searchOut.replaceChildren(head, h("p", { class: "chart-empty" }, "Nic nie znaleziono we włączonych źródłach"));
    searchOut.replaceChildren(
      head,
      h(
        "ol",
        { class: "hit-list" },
        ...r.hits.map((hit) => {
          const href = safeUrl(hit.url);
          const meta = [hit.publisher, fmtDate(hit.published_at), hit.collection].filter(Boolean).join(" · ");
          return h(
            "li",
            { class: "hit" },
            href ? h("a", { class: "hit-title", href, target: "_blank", rel: "noopener noreferrer" }, hit.title) : h("span", { class: "hit-title" }, hit.title),
            h("span", { class: "src-meta" }, meta),
            hit.excerpt ? h("p", { class: "hit-excerpt" }, hit.excerpt) : null,
          );
        }),
      ),
    );
  }

  function sampleSearch(q: string): SearchResult {
    const enabled = new Set(sampleState!.sources.filter((s) => s.enabled).map((s) => s.key));
    const words = fold(q).split(/\s+/).filter(Boolean);
    const corpusOn = enabled.has("route:corpus");
    const hits = SAMPLE_HITS.filter((x) => corpusOn && enabled.has(`corpus:${x.c}`))
      .map((x) => ({ x, score: words.filter((w) => fold(`${x.title} ${x.excerpt}`).includes(w)).length }))
      .filter((r) => r.score > 0 || !words.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ x }) => ({
        title: x.title,
        publisher: sampleState!.sources.find((s) => s.key === `corpus:${x.c}`)?.label ?? x.c,
        url: `https://example.org/przyklad/${x.c}`,
        published_at: x.date,
        collection: x.c,
        excerpt: x.excerpt,
      }));
    return { ms: 8 + q.length * 3, hits };
  }

  // ── controls ──
  content.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".src-toggle");
    if (btn?.dataset.key) toggle(btn.dataset.key);
  });
  filterInput.addEventListener("input", () => {
    filter = fold(filterInput.value.trim());
    if (!state) return;
    for (const sec of SECTIONS) renderSection(sec.kind, sec.title);
  });
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (new FormData(searchForm).get("q") ?? "").toString().trim();
    if (q) runSearch(q);
  });
  const setSample = (on: boolean) => {
    sample = on;
    sampleState = null;
    lastQuery = "";
    searchOut.replaceChildren();
    load();
  };
  sampleSwitch.addEventListener("click", () => setSample(!sample));
  $("test-off").addEventListener("click", () => setSample(false));
  $("gate-sample").addEventListener("click", () => setSample(true));
  $("refresh").addEventListener("click", () => load());
  gateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = (new FormData(gateForm).get("token") ?? "").toString().trim();
    if (!value) return;
    token = value;
    store.set(TOKEN_KEY, value);
    gateForm.reset();
    load();
  });
  logout.addEventListener("click", () => {
    token = null;
    store.set(TOKEN_KEY, null);
    state = null;
    load();
  });

  load();
}

// ── sample data: invented counts, dates and hits (example.org links), never sent anywhere ──
function sampleSources(): SourcesState {
  const route = (id: string, label: string, enabled = true, required = false): Source => ({ key: `route:${id}`, kind: "route", id, label, enabled, required });
  const corpus = (id: string, label: string, records: number, latest: string | null, enabled = true): Source => ({ key: `corpus:${id}`, kind: "corpus", id, label, enabled, records, latest });
  const pub = (id: string, label: string, tier: Tier, access: string, enabled = true): Source => ({ key: `publisher:${id}`, kind: "publisher", id, label, enabled, tier, access });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  return {
    persistence: "kv",
    revision: 7,
    updated_at: ago(42),
    sources: [
      route("corpus", "Własny korpus"),
      route("google_factcheck", "Google Fact Check"),
      route("eli", "Sejm ELI", true, true),
      route("eurostat", "Eurostat"),
      route("nbp", "NBP", false, true),
      route("gus", "GUS"),
      corpus("demagog", "Demagog", 1234, "2026-11-20"),
      corpus("cert", "CERT Polska", 456, "2026-11-18"),
      corpus("imgw", "IMGW", 789, "2026-11-21"),
      corpus("gddkia", "GDDKiA", 321, "2026-11-19"),
      corpus("rcb", "RCB", 210, "2026-11-21"),
      corpus("mon", "MON", 654, "2026-11-15", false),
      corpus("odyseusz", "Odyseusz/MSZ", 98, "2026-11-10"),
      corpus("przyklad", "Zbiór przykładowy bez dat", 12, null),
      pub("demagog", "Demagog", "factcheck", "google_factcheck"),
      pub("gov", "gov.pl", "official", "corpus"),
      pub("sejm", "Sejm RP", "official", "eli"),
      pub("pap", "PAP", "media", "corpus", false),
      pub("przyklad", "Wydawca przykładowy", "media", "corpus"),
    ],
    audit: [
      { at: ago(42), key: "corpus:mon", enabled: false },
      { at: ago(180), key: "route:nbp", enabled: false },
      { at: ago(60 * 26), key: "publisher:pap", enabled: false },
      { at: ago(60 * 30), key: "corpus:imgw", enabled: true },
    ],
  };
}

const SAMPLE_HITS: { c: string; title: string; date: string | null; excerpt: string }[] = [
  { c: "demagog", title: "Przykład: analiza wypowiedzi o cenach prądu", date: "2026-11-20", excerpt: "Przykładowy fragment: wypowiedź o cenach prądu oceniono jako częściowo prawdziwą." },
  { c: "imgw", title: "Przykład: ostrzeżenie przed silnym wiatrem", date: "2026-11-21", excerpt: "Przykładowy fragment: ostrzeżenie drugiego stopnia przed silnym wiatrem i burzą." },
  { c: "rcb", title: "Przykład: alert o burzy i wietrze", date: "2026-11-21", excerpt: "Przykładowy fragment: alert RCB dla trzech województw, wiatr do 90 km/h." },
  { c: "cert", title: "Przykład: kampania fałszywych SMS-ów", date: "2026-11-18", excerpt: "Przykładowy fragment: SMS-y podszywające się pod firmę kurierską, prąd i dopłaty." },
  { c: "gddkia", title: "Przykład: utrudnienia na drodze ekspresowej", date: "2026-11-19", excerpt: "Przykładowy fragment: remont wiaduktu, ruch jednym pasem do końca miesiąca." },
  { c: "mon", title: "Przykład: komunikat o ćwiczeniach wojskowych", date: "2026-11-15", excerpt: "Przykładowy fragment: zaplanowane ćwiczenia, wzmożony ruch kolumn wojskowych." },
  { c: "odyseusz", title: "Przykład: ostrzeżenie dla podróżnych", date: "2026-11-10", excerpt: "Przykładowy fragment: MSZ odradza podróże do wskazanego regionu z powodu burz." },
  { c: "demagog", title: "Przykład: fałszywa informacja o dopłatach", date: "2026-11-17", excerpt: "Przykładowy fragment: rząd nie ogłosił nowych dopłat do prądu, wpis jest fałszywy." },
];
