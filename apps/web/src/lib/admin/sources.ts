/**
 * Admin → Źródła: the operator page of the source registry prototype (architecture/source-platform.md).
 * Every call goes to /api/v1/admin/* with the admin token (sessionStorage, shared with Analityka) and an
 * X-Operator name typed once and kept next to the token. The wire shapes below mirror
 * apps/api/registry-routes.ts and packages/core/src/registry/*; they are declared here because the core
 * root module is Deno code. Everything the API returns is untrusted: text goes through textContent
 * (h()), and only http(s) URLs become links.
 */
import { h } from "../dom.ts";
import { drawRosettes } from "../rosette.ts";

// ── wire types ──
type DocKind = "dated_statement" | "standing_state";
interface Publisher {
  id: string;
  name: string;
  kind: string;
  tier: string;
  role: "evidence" | "context";
  country: string;
  scopes: { host: string; path_prefix?: string }[];
  active: boolean;
  test_data?: boolean;
}
interface Binding {
  id: string;
  label: string;
  publisher_id: string | null;
  aggregator: boolean;
  adapter: string;
  mode: "live" | "corpus";
  config: Record<string, string | number | boolean>;
  allowed_hosts: string[];
  required: boolean;
  doc_kind: DocKind;
  freshness_days: number | null;
  active: boolean;
}
interface Link {
  binding_id: string;
  publisher_id: string;
  active: boolean;
}
interface Draft {
  id: string;
  created_at: string;
  created_by: string;
  base_revision: number;
  change: { publisher?: Publisher; binding?: Binding; links?: Link[] };
  sample: { at: string; query: string; ok: boolean; records: number; eligible: number; errors: string[] } | null;
}
interface AuditEntry {
  at: string;
  operator: string;
  action: string;
  revision: number;
  detail: string;
}
interface SyncState {
  binding_id: string;
  status: "idle" | "running" | "ok" | "error" | "discarded";
  last_finished_at: string | null;
  last_ok_at: string | null;
  items: number;
  stored: number;
  unchanged: number;
  skipped: number;
  message: string | null;
}
interface AdapterField {
  name: string;
  label: string;
  kind: "url" | "text" | "number" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}
interface AdapterSpec {
  type: string;
  label: string;
  mode: "live" | "corpus";
  operator_addable: boolean;
  fields: AdapterField[];
}
interface RegistryView {
  revision: number;
  published_at: string;
  published_by: string;
  publishers: Publisher[];
  bindings: Binding[];
  links: Link[];
  sync: SyncState[];
  drafts: Draft[];
  adapters: AdapterSpec[];
  audit: AuditEntry[];
  backends: { registry: "file" | "memory"; corpus: "memory" | "pgvector"; corpus_revision: number };
  note?: string;
}
interface Inspected {
  route: string;
  title: string;
  url: string;
  publisher: string;
  published_at: string | null;
  excerpt: string;
  eligible: boolean;
  reason: string | null;
}
interface RouteOutcome {
  route: string;
  label: string;
  status: string;
  required: boolean;
  detail?: string;
}
interface DocVersion {
  document_id: string;
  version: number;
  publisher_id: string | null;
  binding_id: string | null;
  kind: DocKind;
  status: "current" | "superseded";
  title: string;
  canonical_url: string;
  published_at: string | null;
  retrieved_at: string;
  effective_from: string | null;
  effective_to: string | null;
  superseded_at: string | null;
  content_hash: string;
  chars: number;
  test_data: boolean;
  text?: string;
}

// ── fixed copy ──
const TIER: Record<string, string> = { official: "urzędowe", factcheck: "fact-checking", media: "media", other: "inne" };
const KIND: Record<string, string> = {
  official: "instytucja publiczna",
  fact_checker: "fact-checker",
  news_agency: "agencja informacyjna",
  public_media: "media publiczne",
};
const SYNC: Record<string, string> = { idle: "nie pobierano", running: "pobieranie…", ok: "pobrano", error: "błąd", discarded: "odrzucono" };
const VERSION: Record<string, string> = { current: "aktualna", superseded: "zastąpiona" };
const REPLACE: Record<string, string> = { new: "nowy", changed: "nowa wersja", unchanged: "bez zmian", adopted: "przejęty" };
const ROUTE: Record<string, string> = {
  hits: "wyniki",
  no_hits: "brak wyników",
  unavailable: "niedostępne",
  error: "błąd",
  timeout: "przekroczony czas",
  skipped: "pominięte",
};
const ACTION: Record<string, string> = {
  draft: "szkic",
  draft_delete: "usunięcie szkicu",
  activate: "aktywacja",
  enable: "włączenie",
  disable: "wyłączenie",
  upload: "dokument",
  sync: "pobranie",
};

const TOKEN_KEY = "prawdowid.admin-token"; // shared with /admin/analityka
const OPERATOR_KEY = "prawdowid.admin-operator";

const session = {
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

/**
 * Header values must be ISO-8859-1 (fetch throws on "ł"), so the name is sent without diacritics and
 * limited to what the API keeps anyway (letters, digits, space . _ @ -, 60 chars).
 */
function headerSafe(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/[^A-Za-z0-9 ._@-]/g, "").trim().slice(0, 60);
}

const dateTime = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short" });
function when(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  // A bare day ("2024-03-05") is a calendar date, not midnight UTC: show it as it is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return dateOnly.format(Date.parse(`${iso}T12:00:00Z`));
  return (withTime ? dateTime : dateOnly).format(t);
}
const span = (from: string | null, to: string | null) => (from || to ? `${from ? when(from, false) : "…"} – ${to ? when(to, false) : "…"}` : "–");

/** A link only for http(s) URLs; anything else (javascript:, data:, junk) stays plain text. */
function link(url: string, text: string, cls?: string): HTMLElement {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") {
      return h("a", { href: u.href, target: "_blank", rel: "noopener", class: cls }, text || u.hostname);
    }
  } catch { /* not a URL */ }
  return h("span", { class: cls }, text || url);
}

function errorList(el: HTMLElement, errors: string[]) {
  el.replaceChildren(...errors.map((e) => h("li", {}, e)));
  el.hidden = !errors.length;
}

type Cell = Node | string;
interface Col {
  label: string;
  cls?: string;
}
/** A table that turns into one card per row in a narrow card (container query in admin.css). */
function table(cols: Col[], rows: { cells: Cell[]; key?: string; onClick?: () => void; selected?: boolean }[], caption?: string): HTMLElement {
  return h(
    "div",
    { class: "t-wrap" },
    h(
      "table",
      { class: "r-table" },
      caption ? h("caption", { class: "sr-only" }, caption) : null,
      h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { scope: "col", class: c.cls }, c.label)))),
      h(
        "tbody",
        {},
        ...rows.map((r) => {
          const tr = h(
            "tr",
            { class: r.onClick ? `is-click${r.selected ? " is-selected" : ""}` : undefined, "data-key": r.key },
            ...r.cells.map((c, i) => h("td", { "data-label": cols[i]?.label, class: cols[i]?.cls }, c)),
          );
          if (r.onClick) {
            tr.addEventListener("click", (e) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              r.onClick!();
            });
          }
          return tr;
        }),
      ),
    ),
  );
}
/** Polish name → registry id (a-z, 0-9, _), e.g. "CERT Polska" → "cert_polska". */
function slug(text: string): string {
  const s = text.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return s.length >= 2 ? s : `zrodlo_${Date.now().toString(36)}`;
}

const empty = (text: string) => h("p", { class: "r-empty" }, text);
/** replaceChildren() would print a null as "null": drop the gaps first. */
const nodes = (...xs: (Node | null | false | undefined)[]) => xs.filter(Boolean) as Node[];

export function initSources() {
  drawRosettes();
  const api = document.body.dataset.api ?? "http://localhost:8787";
  let token = session.get(TOKEN_KEY);
  let operator = session.get(OPERATOR_KEY) ?? "";
  let reg: RegistryView | null = null;
  let request = 0;
  let corpusLoaded = false;
  let selectedDoc: string | null = null;
  /** Problems the API reported when a draft was saved; they block sample and activation. */
  const draftErrors = new Map<string, string[]>();
  /** Last sample output per draft, kept across registry reloads. */
  const samples = new Map<string, HTMLElement>();

  const content = $("content");
  const gate = $("gate");
  const gateForm = $<HTMLFormElement>("gate-form");
  const gateError = $("gate-error");
  const notice = $("notice");
  const logout = $<HTMLButtonElement>("logout");
  const operatorInput = $<HTMLInputElement>("operator");
  const toastEl = $("toast");

  const lock = (on: boolean) => {
    gate.hidden = !on;
    document.body.classList.toggle("is-locked", on);
    logout.hidden = on || !token;
  };

  let toastTimer = 0;
  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4000);
  }

  function showNotice(text: string | null) {
    notice.textContent = text ?? "";
    notice.hidden = !text;
  }

  // ── API ──
  type Result<T> = { ok: true; data: T } | { ok: false; status: number; errors: string[] };
  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Result<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token ?? ""}`, "X-Operator": headerSafe(operator) || "operator" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${api}/api/v1/admin/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { ok: false, status: 0, errors: ["Nie udało się połączyć z API."] };
    }
    // deno-lint-ignore no-explicit-any
    let data: any = null;
    try {
      data = await res.json();
    } catch { /* empty or not JSON */ }
    if (res.ok) return { ok: true, data: data as T };
    if (res.status === 401) {
      token = null;
      session.set(TOKEN_KEY, null);
      lock(true);
      gateError.textContent = "Nieprawidłowy klucz.";
      gateError.hidden = false;
      return { ok: false, status: 401, errors: ["Nieprawidłowy klucz."] };
    }
    const errors: string[] = res.status === 400 && Array.isArray(data?.errors)
      ? data.errors.filter((e: unknown): e is string => typeof e === "string")
      : res.status === 404
      ? ["Nie znaleziono."]
      : res.status === 429
      ? ["Za dużo nieudanych prób klucza. Spróbuj za chwilę."]
      : typeof data?.message === "string"
      ? [data.message]
      : [`API zwróciło błąd ${res.status}.`];
    return { ok: false, status: res.status, errors: errors.length ? errors : [`API zwróciło błąd ${res.status}.`] };
  }

  async function load() {
    const id = ++request;
    if (!token) {
      lock(true);
      gateError.hidden = true;
      return;
    }
    content.classList.add("is-loading");
    const r = await call<RegistryView>("GET", "registry");
    if (id !== request) return;
    content.classList.remove("is-loading");
    if (!r.ok) {
      if (r.status === 401) return;
      lock(false);
      content.hidden = true;
      return showNotice(r.status === 404 ? "Rejestr źródeł jest wyłączony na tym serwerze." : r.errors[0]);
    }
    lock(false);
    showNotice(null);
    content.hidden = false;
    reg = r.data;
    showTab(currentTab());
    render();
    if (!corpusLoaded) {
      corpusLoaded = true;
      loadCorpus();
    }
  }

  function render() {
    if (!reg) return;
    const b = reg.backends;
    const { on, off } = renderSources();
    $("summary").textContent = `Włączonych źródeł: ${on}, wyłączonych: ${off}. Wersja listy ${reg.revision}. ${
      b.corpus === "pgvector" ? "Dokumenty przeszukuje baza wektorowa (pgvector)." : "Dokumenty przeszukuje proste wyszukiwanie słów (bez Dockera)."
    }`;
    $("summary").title = `Rejestr: ${b.registry === "file" ? "plik" : "pamięć"} · rewizja dokumentów ${b.corpus_revision}`;
    if (reg.note) operatorInput.title = reg.note;
    renderAddForm();
    renderDrafts();
    renderDocBindings();
    renderCorpusFilters();
    renderAudit();
  }

  const publisherName = (id: string | null) => reg?.publishers.find((p) => p.id === id)?.name ?? id ?? "–";
  const bindingLabel = (id: string | null) => reg?.bindings.find((b) => b.id === id)?.label ?? id ?? "–";
  const adapterLabel = (type: string) => reg?.adapters.find((a) => a.type === type)?.label ?? type;

  // ── tabs: one task at a time, remembered in the URL hash ──
  const TABS = ["zrodla", "dodaj", "dokumenty", "sprawdz", "dziennik"];
  const currentTab = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "zrodla");
  function showTab(id: string) {
    for (const t of TABS) {
      $(t).hidden = t !== id;
      $(`tab-${t}`).setAttribute("aria-selected", String(t === id));
    }
  }
  for (const t of TABS) {
    $(`tab-${t}`).addEventListener("click", () => {
      history.replaceState(null, "", `#${t}`);
      showTab(t);
    });
  }
  addEventListener("hashchange", () => showTab(currentTab()));

  /** A publisher counts as on when it is active and some active access path reaches it. */
  function reachable(publisherId: string): boolean {
    const r = reg!;
    const p = r.publishers.find((x) => x.id === publisherId);
    if (!p?.active) return false;
    if (r.bindings.some((b) => b.active && !b.aggregator && b.publisher_id === p.id)) return true;
    return r.links.some((l) => l.publisher_id === p.id && l.active && r.bindings.some((b) => b.id === l.binding_id && b.active));
  }

  /** How a source reaches Prawdomat, in plain words. */
  function accessText(b: Binding): string {
    if (b.aggregator) return "przez Google Fact Check";
    if (b.adapter === "rss") return "dokumenty z kanału RSS";
    if (b.adapter === "upload") return "dokumenty dodawane ręcznie";
    if (b.adapter === "json_template") return "wyszukiwanie na żywo w serwisie";
    return "na żywo przez API";
  }

  // ── 1. sources ──
  /** Small on/off switch; the click posts to the given /active route and reloads the registry. */
  function toggle(on: boolean, name: string, path: string): HTMLElement {
    const btn = h(
      "button",
      { type: "button", class: "tgl", role: "switch", "aria-checked": String(on), "aria-label": `Aktywne: ${name}` },
      h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-thumb" })),
      h("span", { class: "tgl-text", "aria-hidden": "true" }, on ? "Wł." : "Wył."),
    );
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await call<{ revision: number }>("POST", path, { active: !on });
      if (!r.ok) {
        btn.disabled = false;
        return toast(r.errors.join(" "));
      }
      toast(`${on ? "Wyłączono" : "Włączono"}: ${name} (rewizja ${r.data.revision})`);
      load();
    });
    return btn;
  }

  function syncLine(b: Binding): HTMLElement {
    const s = reg!.sync.find((x) => x.binding_id === b.id);
    const parts = s
      ? [
        SYNC[s.status] ?? s.status,
        s.last_finished_at ? when(s.last_finished_at) : null,
        s.status !== "idle" ? `${s.items} wpisów, ${s.stored} zapisanych` : null,
      ].filter(Boolean).join(", ")
      : SYNC.idle;
    const btn = h("button", { type: "button", class: "ghost-sm" }, "Pobierz teraz");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Pobieranie…";
      const r = await call<SyncState>("POST", `bindings/${encodeURIComponent(b.id)}/sync`);
      if (!r.ok) {
        btn.disabled = false;
        btn.textContent = "Pobierz teraz";
        return toast(r.errors.join(" "));
      }
      toast(`${b.label}: ${SYNC[r.data.status] ?? r.data.status}${r.data.message ? ` · ${r.data.message}` : ""}`);
      load();
    });
    return h(
      "div",
      { class: `sync${s?.status === "error" || s?.status === "discarded" ? " is-bad" : ""}` },
      h("span", {}, parts),
      s?.message ? h("span", { class: "sync-msg" }, s.message) : null,
      btn,
    );
  }

  function bindingRow(b: Binding): HTMLElement {
    const meta = [accessText(b), b.required ? "wymagane" : null].filter(Boolean).join(", ");
    return h(
      "li",
      { class: `bind${b.active ? "" : " is-off"}`, title: `ID: ${b.id}` },
      h("div", { class: "bind-main" }, h("p", { class: "bind-label" }, b.label), h("p", { class: "src-meta" }, meta)),
      toggle(b.active, b.label, `bindings/${encodeURIComponent(b.id)}/active`),
      b.adapter === "rss" ? syncLine(b) : null,
    );
  }

  /**
   * The allowlist as a ledger: one row per source with who publishes it, where the data comes from and
   * one switch. Extra rows (aggregator publishers, several access paths) unfold under their source.
   */
  function ledgerRow(o: {
    name: string;
    title: string;
    where: string;
    how: string;
    note?: string | null;
    test?: boolean;
    on: boolean;
    sw: HTMLElement;
    sync?: HTMLElement | null;
    more?: HTMLElement | null;
  }): HTMLElement {
    return h(
      "li",
      { class: `led-row${o.on ? "" : " is-off"}`, title: o.title },
      h(
        "div",
        { class: "led-who" },
        h("h3", { class: "led-name" }, o.name, o.test ? h("span", { class: "tag" }, "testowe") : null),
        o.where ? h("p", { class: "led-sub" }, o.where) : null,
      ),
      h(
        "div",
        { class: "led-how" },
        h("p", { class: "led-how-main" }, o.how),
        o.note ? h("p", { class: "led-sub" }, o.note) : null,
        o.sync ?? null,
      ),
      h("div", { class: "led-sw" }, o.sw),
      o.more ? h("div", { class: "led-more" }, o.more) : null,
    );
  }

  function renderSources(): { on: number; off: number } {
    const r = reg!;
    const host = $("sources");
    const known = new Set(r.publishers.map((p) => p.id));
    const groups: HTMLElement[] = [];
    const off: HTMLElement[] = [];

    // Aggregators (and any binding without a known publisher): their links reach many publishers.
    for (const b of r.bindings.filter((x) => x.aggregator || !x.publisher_id || !known.has(x.publisher_id))) {
      const links = r.links.filter((l) => l.binding_id === b.id);
      const linkedOn = links.filter((l) => l.active).length;
      (b.active ? groups : off).push(ledgerRow({
        name: b.label,
        title: `ID: ${b.id}`,
        where: links.length ? `${links.length} wydawców${linkedOn < links.length ? `, w tym ${linkedOn} połączonych` : ""}` : "",
        how: accessText(b) === "przez Google Fact Check" ? "wyszukiwarka weryfikacji (API Google)" : accessText(b),
        note: b.required ? "wymagane przy sprawdzaniu" : null,
        on: b.active,
        sw: toggle(b.active, b.label, `bindings/${encodeURIComponent(b.id)}/active`),
        more: links.length
          ? h(
            "details",
            { class: "links" },
            h("summary", {}, "Wydawcy"),
            h(
              "ul",
              { class: "link-list" },
              ...links.map((l) =>
                h(
                  "li",
                  { class: `link-row${l.active ? "" : " is-off"}` },
                  h("span", {}, publisherName(l.publisher_id)),
                  toggle(
                    l.active,
                    `${b.label} → ${publisherName(l.publisher_id)}`,
                    `links/${encodeURIComponent(b.id)}/${encodeURIComponent(l.publisher_id)}/active`,
                  ),
                )
              ),
            ),
          )
          : null,
      }));
    }

    for (const p of r.publishers) {
      const binds = r.bindings.filter((b) => !b.aggregator && b.publisher_id === p.id);
      const ok = reachable(p.id);
      // One switch per source: the access path gets its own only when it matters (several paths, or it is off).
      const own = binds.length === 1 && binds[0].active ? binds[0] : null;
      const via = r.links.filter((l) => l.publisher_id === p.id).map((l) => bindingLabel(l.binding_id));
      const how = own ? accessText(own) : binds.length ? `${binds.length} sposoby pobierania` : via.length ? `przez ${via.join(", ")}` : "nic nie jest podłączone";
      const notes = [
        own?.required ? "wymagane przy sprawdzaniu" : null,
        p.role === "context" ? "tylko kontekst, nie dowód" : null,
        `waga dowodu: ${TIER[p.tier] ?? p.tier}`,
      ].filter(Boolean) as string[];
      (ok ? groups : off).push(ledgerRow({
        name: p.name,
        title: `ID: ${p.id} · ${KIND[p.kind] ?? p.kind}`,
        where: p.scopes.map((s) => `${s.host}${s.path_prefix ?? ""}`).join(", "),
        how,
        note: notes.join(", "),
        test: p.test_data,
        on: ok,
        sw: toggle(p.active, p.name, `publishers/${encodeURIComponent(p.id)}/active`),
        sync: own?.adapter === "rss" ? syncLine(own) : null,
        more: binds.length && !own ? h("ul", { class: "bind-list" }, ...binds.map(bindingRow)) : null,
      }));
    }
    const ledger = (rows: HTMLElement[]) =>
      h(
        "div",
        { class: "a-card ledger-card" },
        h(
          "div",
          { class: "led-head", "aria-hidden": "true" },
          h("span", {}, "Źródło"),
          h("span", {}, "Skąd dane"),
          h("span", {}, "Włączone"),
        ),
        h("ul", { class: "ledger" }, ...rows),
      );
    host.replaceChildren(...nodes(
      groups.length ? ledger(groups) : empty("Żadne źródło nie jest włączone. Włącz któreś z listy poniżej."),
      off.length
        ? h("details", { class: "src-off" }, h("summary", {}, `Wyłączone (${off.length})`), ledger(off))
        : null,
    ));
    return { on: groups.length, off: off.length };
  }


  // ── 2. add a source ──
  const addForm = $<HTMLFormElement>("add-form");
  const adapterSel = $<HTMLSelectElement>("add-adapter");
  const publisherSel = $<HTMLSelectElement>("add-publisher");
  const newPublisher = $("new-publisher");
  const showNewPublisher = () => {
    const isNew = !publisherSel.value;
    for (const el of [newPublisher, ...addForm.querySelectorAll<HTMLElement>(".new-pub-only")]) el.hidden = !isNew;
  };
  const hostsInput = $<HTMLInputElement>("b-hosts");
  const scopeInput = $<HTMLInputElement>("p-host");
  // Hosts follow the feed / base URL until the operator types their own.
  const touched = new Set<HTMLInputElement>();
  for (const el of [hostsInput, scopeInput]) el.addEventListener("input", () => touched.add(el));

  function replaceOptions(sel: HTMLSelectElement, keep: HTMLOptionElement[], options: [string, string][]) {
    const value = sel.value;
    sel.replaceChildren(...keep, ...options.map(([v, l]) => h("option", { value: v }, l)));
    if ([...sel.options].some((o) => o.value === value)) sel.value = value;
  }

  function renderAddForm() {
    const r = reg!;
    const before = adapterSel.value;
    replaceOptions(adapterSel, [], r.adapters.filter((a) => a.operator_addable).map((a) => [a.type, a.label]));
    replaceOptions(publisherSel, [h("option", { value: "" }, "Nowy wydawca")], r.publishers.map((p) => [p.id, p.name]));
    if (adapterSel.value !== before || !$("adapter-fields").childElementCount) renderAdapterFields();
    showNewPublisher();
  }

  function renderAdapterFields() {
    const spec = reg?.adapters.find((a) => a.type === adapterSel.value);
    const host = $("adapter-fields");
    host.replaceChildren(
      ...(spec?.fields ?? []).map((f) => {
        const id = `cfg-${f.name}`;
        const input = f.kind === "select"
          ? h("select", { id, name: `cfg:${f.name}`, required: f.required }, ...(f.options ?? []).map((o) => h("option", { value: o.value }, o.label)))
          : h("input", {
            id,
            name: `cfg:${f.name}`,
            type: f.kind === "url" ? "url" : f.kind === "number" ? "number" : "text",
            min: f.kind === "number" ? "1" : undefined,
            placeholder: f.placeholder,
            required: f.required,
          });
        if (f.kind === "url") input.addEventListener("input", () => followHost((input as HTMLInputElement).value));
        return h("div", { class: f.kind === "url" ? "field is-wide" : "field" }, h("label", { for: id }, f.label), input);
      }),
    );
    host.hidden = !spec?.fields.length;
    for (const el of addForm.querySelectorAll<HTMLElement>(".corpus-only")) el.hidden = spec?.mode === "live";
  }

  function followHost(url: string) {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch { /* still typing */ }
    if (!touched.has(hostsInput)) hostsInput.value = hostname;
    if (!touched.has(scopeInput)) scopeInput.value = hostname;
  }

  adapterSel.addEventListener("change", renderAdapterFields);
  publisherSel.addEventListener("change", showNewPublisher);

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(addForm);
    const val = (k: string) => String(fd.get(k) ?? "").trim();
    const spec = reg?.adapters.find((a) => a.type === val("adapter"));
    const config: Record<string, string> = {};
    for (const f of spec?.fields ?? []) if (val(`cfg:${f.name}`)) config[f.name] = val(`cfg:${f.name}`);
    const pick = val("publisher_pick");
    const pubName = pick ? publisherName(pick) : val("p_name");
    if (!pick && (!pubName || !val("p_host"))) return errorList($("add-errors"), ["Podaj nazwę i domenę wydawcy."]);
    // IDs and the source name follow the publisher name unless set under "Więcej opcji".
    const pubId = pick || val("p_id") || slug(pubName);
    const suffix = { rss: "rss", upload: "dokumenty", json_template: "wyszukiwanie" }[val("adapter")] ?? "zrodlo";
    const body: Record<string, unknown> = {
      binding: {
        id: val("b_id") || `${pubId}_${suffix}`.slice(0, 63),
        label: val("b_label") || `${pubName}: ${adapterLabel(val("adapter"))}`,
        publisher_id: pubId,
        adapter: val("adapter"),
        config,
        allowed_hosts: val("b_hosts").split(/[\s,]+/).filter(Boolean),
        required: fd.get("b_required") === "on",
        doc_kind: val("b_kind") || "dated_statement",
        freshness_days: val("b_fresh") ? Number(val("b_fresh")) : null,
      },
    };
    if (!pick) {
      body.publisher = {
        id: pubId,
        name: pubName,
        tier: val("p_tier"),
        kind: val("p_kind"),
        scopes: [{ host: val("p_host"), path_prefix: val("p_path") || undefined }],
      };
    }
    const btn = addForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
    btn.disabled = true;
    const r = await call<{ draft: Draft; errors: string[] }>("POST", "registry/drafts", body);
    btn.disabled = false;
    if (!r.ok) return errorList($("add-errors"), r.errors);
    const errors = r.data.errors ?? [];
    errorList($("add-errors"), errors);
    if (errors.length) draftErrors.set(r.data.draft.id, errors);
    else {
      addForm.reset();
      touched.clear();
      renderAdapterFields();
    }
    toast(errors.length ? "Zapisano, ale są błędy do poprawienia." : "Zapisano. Teraz przetestuj i aktywuj (u góry).");
    load();
  });

  // ── drafts ──
  function renderDrafts() {
    const r = reg!;
    const host = $("drafts");
    for (const id of [...samples.keys()]) if (!r.drafts.some((d) => d.id === id)) samples.delete(id);
    $("drafts-card").hidden = !r.drafts.length;
    if (!r.drafts.length) return host.replaceChildren();
    host.replaceChildren(h("div", { class: "draft-list" }, ...r.drafts.map(draftCard)));
  }

  function draftCard(d: Draft): HTMLElement {
    const b = d.change.binding;
    const p = d.change.publisher;
    const title = b?.label || p?.name || `Szkic ${d.id.slice(0, 8)}`;
    const meta = [
      b ? `${b.id} · ${adapterLabel(b.adapter)}` : null,
      p ? `nowy wydawca ${p.id}` : b?.publisher_id ? publisherName(b.publisher_id) : null,
      `${d.created_by}, ${when(d.created_at)}`,
      d.base_revision !== reg!.revision ? `od rewizji ${d.base_revision}` : null,
    ].filter(Boolean).join(", ");
    const s = d.sample;
    const sampleLine = s
      ? s.ok ? `Test: ${s.eligible} z ${s.records} wpisów przechodzi${s.query ? ` („${s.query}”)` : ""}` : `Test nieudany${s.errors?.length ? `: ${s.errors.join("; ")}` : ""}`
      : null;

    const out = samples.get(d.id) ?? h("div", { class: "r-out" });
    samples.set(d.id, out);
    const errs = h("ul", { class: "r-errors", role: "alert" });
    errorList(errs, draftErrors.get(d.id) ?? []);

    const query = h("input", { type: "search", class: "r-input", placeholder: "Słowo do testu, np. podatność", "aria-label": `Zapytanie testowe: ${title}` });
    const test = h("button", { type: "button", class: "ghost-sm" }, "1. Testuj");
    const activate = h("button", { type: "button", class: "pill-btn is-sm" }, "2. Aktywuj");
    const del = h("button", { type: "button", class: "ghost-sm is-danger" }, "Usuń");

    test.addEventListener("click", async () => {
      test.disabled = true;
      test.textContent = "Testuję…";
      const r = await call<{ ok: boolean; errors: string[]; note: string | null; records: Inspected[] }>(
        "POST",
        `registry/drafts/${encodeURIComponent(d.id)}/sample`,
        { query: query.value.trim() },
      );
      test.disabled = false;
      test.textContent = "1. Testuj";
      if (!r.ok) return errorList(errs, r.errors);
      errorList(errs, r.data.errors ?? []);
      out.replaceChildren(...nodes(
        r.data.note ? h("p", { class: "r-note" }, r.data.note) : null,
        r.data.records.length ? recordTable(r.data.records, true) : null,
      ));
      load();
    });
    activate.addEventListener("click", async () => {
      activate.disabled = true;
      const r = await call<{ revision: number }>("POST", `registry/drafts/${encodeURIComponent(d.id)}/activate`);
      activate.disabled = false;
      if (!r.ok) return errorList(errs, r.errors);
      draftErrors.delete(d.id);
      toast(`Aktywowano: ${title} (rewizja ${r.data.revision})`);
      load();
    });
    del.addEventListener("click", async () => {
      del.disabled = true;
      const r = await call<{ deleted: boolean }>("DELETE", `registry/drafts/${encodeURIComponent(d.id)}`);
      del.disabled = false;
      if (!r.ok) return errorList(errs, r.errors);
      draftErrors.delete(d.id);
      toast("Szkic usunięty.");
      load();
    });
    query.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        test.click();
      }
    });

    return h(
      "article",
      { class: "draft" },
      h("h4", { class: "bind-label" }, title),
      h("p", { class: "src-meta" }, meta),
      sampleLine ? h("p", { class: `src-meta${s?.ok ? "" : " is-bad"}` }, sampleLine) : null,
      errs,
      h("div", { class: "r-actions" }, query, test, activate, del),
      out,
    );
  }

  /** Records from a sample or a probe; `eligibility` adds the ✓ / reason column. */
  function recordTable(records: Inspected[], eligibility: boolean): HTMLElement {
    const cols: Col[] = [{ label: "Tytuł", cls: "t-title" }, { label: "Wydawca" }, { label: "Data", cls: "nowrap" }];
    if (eligibility) cols.push({ label: "Przechodzi" });
    else cols.push({ label: "Fragment", cls: "t-excerpt" });
    return table(
      cols,
      records.map((x) => ({
        cells: [
          link(x.url, x.title),
          x.publisher || "–",
          when(x.published_at, false),
          eligibility
            ? x.eligible ? h("span", { class: "ok-mark", "aria-label": "tak" }, "✓") : h("span", { class: "bad-text" }, x.reason ?? "nie")
            : x.excerpt || "–",
        ],
      })),
    );
  }

  // ── 3. documents ──
  const docForm = $<HTMLFormElement>("doc-form");
  const docBinding = $<HTMLSelectElement>("d-binding");
  function renderDocBindings() {
    const uploads = reg!.bindings.filter((b) => b.adapter === "upload");
    replaceOptions(docBinding, [], uploads.map((b) => [b.id, `${b.label}${b.active ? "" : " (wyłączone)"}`]));
    const none = !uploads.length;
    docForm.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = none;
    if (none) replaceOptions(docBinding, [h("option", { value: "" }, "Brak powiązań typu „dokumenty”")], []);
  }

  docForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(docForm);
    const val = (k: string) => String(fd.get(k) ?? "").trim();
    const btn = docForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
    btn.disabled = true;
    $("doc-result").hidden = true;
    const r = await call<{ document_id: string; version: number; status: string; corpus_revision: number }>(
      "POST",
      `bindings/${encodeURIComponent(val("binding"))}/documents`,
      {
        title: val("title"),
        canonical_url: val("canonical_url"),
        published_at: val("published_at") || null,
        kind: val("kind") || undefined,
        effective_from: val("effective_from") || null,
        effective_to: val("effective_to") || null,
        text: String(fd.get("text") ?? ""),
        document_id: val("document_id") || undefined,
      },
    );
    btn.disabled = false;
    if (!r.ok) return errorList($("doc-errors"), r.errors);
    errorList($("doc-errors"), []);
    const res = $("doc-result");
    res.textContent = `${r.data.document_id}: wersja ${r.data.version}, ${REPLACE[r.data.status] ?? r.data.status} · rewizja korpusu ${r.data.corpus_revision}`;
    res.hidden = false;
    docForm.reset();
    selectedDoc = r.data.document_id;
    loadCorpus();
    load();
  });

  // ── 4. corpus ──
  const corpusForm = $<HTMLFormElement>("corpus-form");
  function renderCorpusFilters() {
    const r = reg!;
    replaceOptions($("c-pub"), [h("option", { value: "" }, "Wszyscy")], r.publishers.map((p) => [p.id, p.name]));
    replaceOptions($("c-bind"), [h("option", { value: "" }, "Wszystkie")], r.bindings.filter((b) => b.mode === "corpus").map((b) => [b.id, b.label]));
  }

  async function loadCorpus() {
    const fd = new FormData(corpusForm);
    const q = new URLSearchParams();
    for (const k of ["publisher_id", "binding_id", "q", "date"]) {
      const v = String(fd.get(k) ?? "").trim();
      if (v) q.set(k, v);
    }
    if (fd.get("include_superseded") === "on") q.set("include_superseded", "1");
    const out = $("corpus-out");
    out.classList.add("is-loading");
    const r = await call<{ documents: DocVersion[]; corpus_revision: number }>("GET", `corpus?${q}`);
    out.classList.remove("is-loading");
    if (!r.ok) return out.replaceChildren(empty(r.errors.join(" ")));
    const docs = r.data.documents;
    if (!docs.length) return out.replaceChildren(empty("Brak dokumentów."));
    out.replaceChildren(
      h("p", { class: "r-note" }, `${docs.length} ${docs.length === 1 ? "dokument" : "dokumentów"}. Kliknij wiersz, żeby zobaczyć wersje.`),
      table(
        [
          { label: "Tytuł", cls: "t-title" },
          { label: "Wydawca" },
          { label: "Wersja", cls: "num" },
          { label: "Opublikowano", cls: "nowrap" },
          { label: "Obowiązuje", cls: "nowrap" },
        ],
        docs.map((d) => {
          const versions = h("button", { type: "button", class: "row-btn", "aria-label": `Wersje: ${d.title}` }, "Wersje");
          versions.addEventListener("click", () => loadHistory(d.document_id));
          return {
            key: d.document_id,
            selected: d.document_id === selectedDoc,
            onClick: () => loadHistory(d.document_id),
            cells: [
              h("div", {}, link(d.canonical_url, d.title), d.test_data ? h("span", { class: "tag" }, "testowe") : null, versions),
              publisherName(d.publisher_id),
              `${d.version}${d.status === "superseded" ? " (stara)" : ""}`,
              when(d.published_at, false),
              span(d.effective_from, d.effective_to),
            ],
          };
        }),
        "Dokumenty",
      ),
    );
  }

  async function loadHistory(documentId: string) {
    selectedDoc = documentId;
    // Highlight the row whose history is open, without refetching the list.
    for (const tr of $("corpus-out").querySelectorAll<HTMLTableRowElement>("tr.is-click")) {
      tr.classList.toggle("is-selected", tr.dataset.key === documentId);
    }
    const host = $("corpus-history");
    host.replaceChildren(h("p", { class: "r-note" }, "Wczytuję wersje…"));
    const r = await call<{ document_id: string; versions: DocVersion[] }>("GET", `corpus/versions?document_id=${encodeURIComponent(documentId)}`);
    if (!r.ok) return host.replaceChildren(empty(r.errors.join(" ")));
    const versions = [...r.data.versions].sort((a, b) => b.version - a.version);
    const head = versions[0];
    const replace = h("button", { type: "button", class: "ghost-sm" }, "Zastąp");
    replace.addEventListener("click", () => {
      if (head?.binding_id && [...docBinding.options].some((o) => o.value === head.binding_id)) docBinding.value = head.binding_id;
      $<HTMLInputElement>("d-docid").value = documentId;
      if (head) {
        $<HTMLInputElement>("d-title").value = head.title;
        $<HTMLInputElement>("d-url").value = head.canonical_url;
      }
      ($("doc-card") as HTMLDetailsElement).open = true;
      $("doc-card").scrollIntoView({ behavior: "smooth", block: "start" });
      $<HTMLTextAreaElement>("d-text").focus({ preventScroll: true });
    });
    host.replaceChildren(
      h(
        "div",
        { class: "hist-head" },
        h("h3", { class: "r-sub" }, head?.title ?? documentId),
        h("code", { class: "src-meta" }, documentId),
        head?.binding_id && reg?.bindings.find((b) => b.id === head.binding_id)?.adapter === "upload" ? replace : null,
      ),
      table(
        [
          { label: "Wersja", cls: "num" },
          { label: "Status" },
          { label: "Opublikowano", cls: "nowrap" },
          { label: "Obowiązuje", cls: "nowrap" },
          { label: "Zastąpiono", cls: "nowrap" },
          { label: "Skrót", cls: "nowrap" },
          { label: "Znaki", cls: "num" },
          { label: "Treść", cls: "t-excerpt" },
        ],
        versions.map((v) => ({
          cells: [
            String(v.version),
            VERSION[v.status] ?? v.status,
            when(v.published_at, false),
            span(v.effective_from, v.effective_to),
            when(v.superseded_at),
            h("code", {}, v.content_hash.slice(0, 12)),
            v.chars.toLocaleString("pl-PL"),
            v.text
              ? h(
                "details",
                { class: "preview" },
                h("summary", {}, v.text.length > 140 ? `${v.text.slice(0, 140).replace(/\s+/g, " ")}…` : v.text),
                h("pre", { class: "r-pre" }, v.text),
              )
              : "–",
          ],
        })),
        "Historia wersji",
      ),
    );
  }

  corpusForm.addEventListener("submit", (e) => {
    e.preventDefault();
    loadCorpus();
  });

  // ── 5. probe ──
  const probeForm = $<HTMLFormElement>("probe-form");
  probeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(probeForm);
    const val = (k: string) => String(fd.get(k) ?? "").trim();
    const out = $("probe-out");
    const btn = probeForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
    btn.disabled = true;
    out.replaceChildren(h("p", { class: "r-note" }, "Sprawdzam…"));
    const r = await call<{ revision: number; corpus_revision: number; routes: RouteOutcome[]; records: Inspected[]; dropped: Inspected[] }>(
      "POST",
      "evidence/probe",
      { text: val("text"), type: val("type") || undefined, time: val("time") || undefined },
    );
    btn.disabled = false;
    if (!r.ok) return out.replaceChildren(h("ul", { class: "r-errors" }, ...r.errors.map((x) => h("li", {}, x))));
    const d = r.data;
    out.replaceChildren(...nodes(
      h("h3", { class: "r-sub" }, "Przeszukane źródła"),
      h(
        "ul",
        { class: "route-list" },
        ...d.routes.map((x) =>
          h(
            "li",
            {},
            h("span", { class: `st st-${["error", "timeout", "unavailable"].includes(x.status) ? "bad" : x.status === "hits" ? "hits" : "idle"}` }, ROUTE[x.status] ?? x.status),
            h("span", { class: "route-name" }, x.label || x.route, x.required ? h("span", { class: "src-meta" }, " · wymagane") : null),
            x.detail ? h("span", { class: "src-meta route-detail" }, x.detail) : null,
          )
        ),
      ),
      h("h3", { class: "r-sub" }, `Znalezione (${d.records.length})`),
      d.records.length ? recordTable(d.records, false) : empty("Brak."),
      d.dropped.length
        ? h(
          "details",
          { class: "links" },
          h("summary", {}, `Odrzucone, bo spoza zatwierdzonych wydawców (${d.dropped.length})`),
          table(
            [{ label: "Tytuł", cls: "t-title" }, { label: "Trasa" }, { label: "Powód" }],
            d.dropped.map((x) => ({ cells: [link(x.url, x.title), bindingLabel(x.route), h("span", { class: "bad-text" }, x.reason ?? "–")] })),
          ),
        )
        : null,
    ));
  });

  // ── 6. audit ──
  function renderAudit() {
    const r = reg!;
    const rows = [...r.audit].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (!rows.length) return $("audit").replaceChildren(empty("Brak wpisów."));
    $("audit").replaceChildren(
      table(
        [{ label: "Czas", cls: "nowrap" }, { label: "Operator" }, { label: "Akcja" }, { label: "Rewizja", cls: "num" }, { label: "Szczegóły" }],
        rows.map((a) => ({ cells: [when(a.at), a.operator, ACTION[a.action] ?? a.action, String(a.revision), a.detail] })),
        "Dziennik zmian",
      ),
    );
  }

  // ── controls ──
  operatorInput.value = operator;
  operatorInput.addEventListener("change", () => {
    operator = operatorInput.value.trim();
    session.set(OPERATOR_KEY, operator || null);
  });
  $("refresh").addEventListener("click", () => {
    load();
    loadCorpus();
  });
  gateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(gateForm);
    const value = String(fd.get("token") ?? "").trim();
    if (!value) return;
    token = value;
    session.set(TOKEN_KEY, value);
    const name = String(fd.get("operator") ?? "").trim();
    if (name) {
      operator = name;
      operatorInput.value = name;
      session.set(OPERATOR_KEY, name);
    }
    gateForm.reset();
    load();
  });
  logout.addEventListener("click", () => {
    token = null;
    session.set(TOKEN_KEY, null);
    reg = null;
    corpusLoaded = false;
    content.hidden = true;
    load();
  });

  load();
}
