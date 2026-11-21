/**
 * Eligibility: the one rule every evidence record passes, from live adapters, the corpus or a shared
 * aggregator. The citation URL is resolved against the approved host and path scopes; the most specific
 * scope wins (more host labels, then the longer path prefix). A URL that matches no scope, or matches two
 * publishers equally well, is rejected.
 */
import type { Binding, CitationScope, Publisher, Registry } from "./types.ts";

export type IneligibleReason =
  | "bad_url"
  | "url_out_of_scope"
  | "url_ambiguous"
  | "binding_unknown"
  | "binding_inactive"
  | "publisher_unknown"
  | "publisher_inactive"
  | "publisher_mismatch"
  | "link_missing"
  | "link_inactive"
  | "context_only";

export const INELIGIBLE_PL: Record<IneligibleReason, string> = {
  bad_url: "nieprawidłowy adres",
  url_out_of_scope: "adres poza zakresem zatwierdzonych wydawców",
  url_ambiguous: "adres pasuje do kilku wydawców",
  binding_unknown: "nieznane powiązanie",
  binding_inactive: "powiązanie wyłączone",
  publisher_unknown: "nieznany wydawca",
  publisher_inactive: "wydawca wyłączony",
  publisher_mismatch: "adres należy do innego wydawcy niż powiązanie",
  link_missing: "agregator nie ma połączenia z tym wydawcą",
  link_inactive: "połączenie agregatora z wydawcą wyłączone",
  context_only: "wydawca tylko jako kontekst, nie dowód",
};

export type Eligibility =
  | { ok: true; publisher: Publisher; binding: Binding }
  | { ok: false; reason: IneligibleReason; message: string; publisher?: Publisher };

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** "" for no prefix; otherwise "/a/b" without a trailing slash. */
export function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const p = prefix.trim();
  if (!p || p === "/") return "";
  return (p.startsWith("/") ? p : `/${p}`).replace(/\/+$/, "");
}

function hostMatches(urlHost: string, scopeHost: string): boolean {
  return urlHost === scopeHost || urlHost.endsWith(`.${scopeHost}`);
}

function pathMatches(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

export type ScopeResolution =
  | { ok: true; publisher: Publisher; scope: CitationScope }
  | { ok: false; reason: "bad_url" | "url_out_of_scope" | "url_ambiguous"; candidates?: string[] };

/** Which publisher a citation URL belongs to, by the most specific matching scope. */
export function resolveCitation(url: string, publishers: Publisher[]): ScopeResolution {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "bad_url" };
  const host = normalizeHost(u.hostname);
  const path = u.pathname;
  let best: { spec: [number, number]; matches: { publisher: Publisher; scope: CitationScope }[] } | null =
    null;
  for (const publisher of publishers) {
    for (const scope of publisher.scopes) {
      const sh = normalizeHost(scope.host);
      const sp = normalizePrefix(scope.path_prefix);
      if (!hostMatches(host, sh) || !pathMatches(path, sp)) continue;
      const spec: [number, number] = [sh.split(".").length, sp.length];
      const cmp = best ? spec[0] - best.spec[0] || spec[1] - best.spec[1] : 1;
      if (cmp > 0) best = { spec, matches: [{ publisher, scope }] };
      else if (cmp === 0) best!.matches.push({ publisher, scope });
    }
  }
  if (!best) return { ok: false, reason: "url_out_of_scope" };
  const ids = [...new Set(best.matches.map((m) => m.publisher.id))];
  if (ids.length > 1) return { ok: false, reason: "url_ambiguous", candidates: ids };
  return { ok: true, ...best.matches[0] };
}

function no(reason: IneligibleReason, publisher?: Publisher): Eligibility {
  return { ok: false, reason, message: INELIGIBLE_PL[reason], publisher };
}

/** Is a record from this binding with this citation URL usable as evidence under this registry revision? */
export function checkEligibility(reg: Registry, bindingId: string, url: string): Eligibility {
  const binding = reg.bindings.find((b) => b.id === bindingId);
  if (!binding) return no("binding_unknown");
  const resolved = resolveCitation(url, reg.publishers);
  if (!resolved.ok) return no(resolved.reason);
  const publisher = resolved.publisher;
  if (!binding.active) return no("binding_inactive", publisher);
  if (binding.aggregator) {
    const link = reg.links.find((l) => l.binding_id === binding.id && l.publisher_id === publisher.id);
    if (!link) return no("link_missing", publisher);
    if (!link.active) return no("link_inactive", publisher);
  } else if (binding.publisher_id !== publisher.id) {
    return no("publisher_mismatch", publisher);
  }
  if (!publisher.active) return no("publisher_inactive", publisher);
  if (publisher.role !== "evidence") return no("context_only", publisher);
  return { ok: true, publisher, binding };
}

/** Publishers a binding may currently produce evidence for (active, evidence role, active link). */
export function eligiblePublishers(reg: Registry, binding: Binding): Publisher[] {
  if (!binding.active) return [];
  const ok = (p: Publisher) => p.active && p.role === "evidence";
  if (!binding.aggregator) return reg.publishers.filter((p) => p.id === binding.publisher_id && ok(p));
  const linked = new Set(
    reg.links.filter((l) => l.binding_id === binding.id && l.active).map((l) => l.publisher_id),
  );
  return reg.publishers.filter((p) => linked.has(p.id) && ok(p));
}

/** A binding can run when it is active and can still reach at least one eligible publisher. */
export function bindingUsable(reg: Registry, binding: Binding): boolean {
  return binding.active && eligiblePublishers(reg, binding).length > 0;
}
