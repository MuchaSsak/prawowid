/** Renders the canonical CheckResponse. Verdicts and system states look clearly different (constraint 8). */
import type { CheckResponse, Citation, ClaimResult, Warning } from "@prawdowid/core/types";
import { h, safeLink } from "./dom.ts";

const STANCE_PL: Record<Citation["stance"], string> = {
  supports: "potwierdza",
  refutes: "zaprzecza",
  misleading: "pokazuje inny kontekst",
  context: "kontekst",
};
const STRENGTH_PL = { high: "Wysoka", medium: "Średnia", low: "Niska" } as const;
const STATE_PL = {
  source_unavailable: "Źródło niedostępne",
  technical_error: "Błąd techniczny",
  not_processed: "Nie sprawdzono (limit)",
} as const;

function date(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(d);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString("pl-PL");
}

function warnings(ws: Warning[]): HTMLElement | null {
  if (!ws.length) return null;
  return h("ul", { class: "warnings" }, ...ws.map((w) => h("li", { class: `warn warn-${w.type}` }, w.text)));
}

function citation(c: Citation): HTMLElement {
  return h(
    "li",
    { class: `cite stance-${c.stance}` },
    h("blockquote", {}, `„${c.excerpt}”`),
    h(
      "div",
      { class: "cite-meta" },
      h("span", { class: `stance stance-${c.stance}` }, STANCE_PL[c.stance]),
      " · ",
      h("strong", {}, c.publisher),
      c.published_at ? ` · ${date(c.published_at)}` : "",
      " · ",
      safeLink(c.url, c.title.length > 90 ? c.title.slice(0, 90) + "…" : c.title),
    ),
  );
}

function claimCard(c: ClaimResult): HTMLElement {
  const isState = c.system_state !== null;
  const head = isState
    ? h("span", { class: "state-label" }, "⚠ ", STATE_PL[c.system_state!])
    : h("span", { class: `verdict v-${c.verdict}` }, c.verdict_label ?? "");

  const sources = c.citations.length
    ? h(
      "div",
      { class: "sources" },
      h("h4", {}, "Co mówią źródła"),
      h("ul", { class: "cites" }, ...c.citations.map(citation)),
    )
    : null;

  const routes = c.routes.length
    ? h(
      "details",
      { class: "routes" },
      h("summary", {}, "Gdzie szukaliśmy"),
      h(
        "ul",
        {},
        ...c.routes.map((r) =>
          h("li", {}, `${r.label}: `, h("span", { class: `route route-${r.status}` }, routeText(r.status)), r.detail ? ` (${r.detail})` : "")
        ),
      ),
    )
    : null;

  return h(
    "article",
    { class: `card claim ${isState ? "is-state" : ""}` },
    h("div", { class: "claim-head" }, head, c.strength ? h("span", { class: "strength" }, `Siła dowodów: ${STRENGTH_PL[c.strength.level]}`) : null),
    h("p", { class: "claim-text" }, c.text),
    isState
      ? h("p", { class: "state-text" }, c.system_message ?? "")
      : h("div", { class: "assessment" }, h("h4", {}, "Nasza ocena"), h("p", {}, c.explanation), c.missing ? h("p", { class: "muted" }, c.missing) : null),
    c.strength && c.strength.reasons.length ? h("p", { class: "reasons" }, c.strength.reasons.join(" · ")) : null,
    warnings(c.warnings),
    sources,
    routes,
  );
}

function routeText(s: string): string {
  return ({
    hits: "znaleziono wyniki",
    no_hits: "brak wyników",
    unavailable: "niedostępne",
    error: "błąd",
    timeout: "przekroczony czas",
    skipped: "pominięte",
  } as Record<string, string>)[s] ?? s;
}

export function renderResult(root: HTMLElement, r: CheckResponse) {
  root.replaceChildren();
  const parts: (HTMLElement | null)[] = [];

  if (r.system_message) {
    parts.push(
      h(
        "div",
        { class: `system-banner status-${r.status}`, role: "status" },
        h("strong", {}, r.system_message.title),
        h("p", {}, r.system_message.text),
      ),
    );
  }

  if (r.input.title || r.input.url || r.input.description) {
    parts.push(
      h(
        "div",
        { class: "input-meta" },
        r.input.url ? h("div", {}, "Sprawdzana strona: ", safeLink(r.input.url, r.input.title ?? r.input.url)) : null,
        r.input.published_at ? h("div", { class: "muted" }, `Data publikacji: ${date(r.input.published_at)}`) : null,
        r.input.description ? h("div", {}, h("span", { class: "muted" }, "Na obrazie: "), r.input.description) : null,
      ),
    );
  }

  if (r.claims.length) parts.push(h("p", { class: "summary" }, r.summary.text));
  parts.push(warnings(r.warnings));
  if (r.escalation.state === "recommended" && r.escalation.reason) {
    parts.push(h("div", { class: "escalation" }, r.escalation.reason));
  }
  for (const c of r.claims) parts.push(claimCard(c));

  if (r.limitations.length) {
    parts.push(
      h(
        "details",
        { class: "limits" },
        h("summary", {}, "Ograniczenia"),
        h("ul", {}, ...r.limitations.map((l) => h("li", {}, l))),
      ),
    );
  }
  const m = r.meta;
  parts.push(
    h(
      "p",
      { class: "meta" },
      `Czas: ${(m.latency_ms / 1000).toFixed(1)} s`,
      m.cached ? " (wynik z pamięci podręcznej)" : "",
      ` · koszt: $${m.cost_usd.toFixed(4)}`,
      m.models.length ? ` · modele: ${m.models.join(", ")}` : "",
      ` · id: ${r.check_id.slice(0, 8)}`,
    ),
  );
  root.append(...parts.filter((p): p is HTMLElement => p !== null));
}
