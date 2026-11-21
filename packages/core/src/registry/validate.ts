/** Registry validation, run on every publish: a revision that fails never becomes active. */
import { validateBindingConfig } from "./adapters.ts";
import { normalizeHost, normalizePrefix } from "./eligibility.ts";
import type { RegistryContent } from "./types.ts";

const ID = /^[a-z0-9][a-z0-9_]{1,62}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ENV = /^[A-Z][A-Z0-9_]{1,63}$/;
const TIERS = ["official", "factcheck", "media", "other"];
const KINDS = ["official", "fact_checker", "news_agency", "public_media"];

export function validateRegistry(c: RegistryContent): string[] {
  const errors: string[] = [];
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${what} ${id} występuje dwa razy`);
      seen.add(id);
    }
  };
  dup(c.publishers.map((p) => p.id), "wydawca");
  dup(c.bindings.map((b) => b.id), "powiązanie");
  dup(c.links.map((l) => `${l.binding_id}→${l.publisher_id}`), "połączenie");

  const publishers = new Map(c.publishers.map((p) => [p.id, p]));
  const scopeOwner = new Map<string, string>();
  for (const p of c.publishers) {
    if (!ID.test(p.id)) errors.push(`wydawca ${p.id}: identyfikator tylko z małych liter, cyfr i _`);
    if (!p.name?.trim()) errors.push(`wydawca ${p.id}: brak nazwy`);
    if (!TIERS.includes(p.tier)) errors.push(`wydawca ${p.id}: nieznany poziom ${p.tier}`);
    if (!KINDS.includes(p.kind)) errors.push(`wydawca ${p.id}: nieznany rodzaj ${p.kind}`);
    if (p.role !== "evidence" && p.role !== "context") {
      errors.push(`wydawca ${p.id}: rola evidence albo context`);
    }
    if (!p.scopes.length) errors.push(`wydawca ${p.id}: brak zakresu adresów cytowań`);
    for (const s of p.scopes) {
      const host = normalizeHost(s.host ?? "");
      if (!HOST.test(host)) {
        errors.push(`wydawca ${p.id}: nieprawidłowy host ${s.host}`);
        continue;
      }
      if (s.path_prefix && !s.path_prefix.startsWith("/")) {
        errors.push(`wydawca ${p.id}: ścieżka musi zaczynać się od /`);
      }
      const key = `${host}${normalizePrefix(s.path_prefix)}`;
      const owner = scopeOwner.get(key);
      if (owner && owner !== p.id) {
        errors.push(`zakres ${key} przypisany do dwóch wydawców: ${owner} i ${p.id}`);
      }
      scopeOwner.set(key, p.id);
    }
  }

  const bindings = new Map(c.bindings.map((b) => [b.id, b]));
  for (const b of c.bindings) {
    if (!ID.test(b.id)) errors.push(`powiązanie ${b.id}: identyfikator tylko z małych liter, cyfr i _`);
    if (b.publisher_id && !publishers.has(b.publisher_id)) {
      errors.push(`powiązanie ${b.id}: nieznany wydawca ${b.publisher_id}`);
    }
    if (b.aggregator && b.publisher_id) errors.push(`powiązanie ${b.id}: agregator nie ma jednego wydawcy`);
    for (const h of b.allowed_hosts) {
      if (!HOST.test(normalizeHost(h))) errors.push(`powiązanie ${b.id}: nieprawidłowy host ${h}`);
    }
    if (b.credential_env !== null && !ENV.test(b.credential_env)) {
      errors.push(
        `powiązanie ${b.id}: credential_env to nazwa zmiennej środowiskowej (np. API_KEY), nie wartość`,
      );
    }
    if (b.freshness_days !== null && (!Number.isInteger(b.freshness_days) || b.freshness_days < 1)) {
      errors.push(`powiązanie ${b.id}: świeżość w dniach musi być liczbą całkowitą ≥ 1`);
    }
    if (b.doc_kind !== "dated_statement" && b.doc_kind !== "standing_state") {
      errors.push(`powiązanie ${b.id}: nieznany rodzaj dokumentów`);
    }
    errors.push(...validateBindingConfig(b));
  }

  for (const l of c.links) {
    const b = bindings.get(l.binding_id);
    if (!b) errors.push(`połączenie ${l.binding_id}→${l.publisher_id}: nieznane powiązanie`);
    else if (!b.aggregator) {
      errors.push(`połączenie ${l.binding_id}→${l.publisher_id}: powiązanie nie jest agregatorem`);
    }
    if (!publishers.has(l.publisher_id)) {
      errors.push(`połączenie ${l.binding_id}→${l.publisher_id}: nieznany wydawca`);
    }
  }
  return errors;
}
