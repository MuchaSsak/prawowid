/**
 * Structural check of a `POST /api/v1/check` body against contract v1, bundled with the bot (no
 * runtime dependency on GET /schema). It checks shapes and types, not enum values: v1 is additive,
 * so an unknown `status`, `system_state` or warning `type` must still render, as a generic system
 * notice (api-reference.md, "Versioning rules"). Anything structurally wrong is reported, and the
 * conversation turns it into a `technical_error` notice, never a verdict.
 */
import type { CheckResponse } from "@prawdowid/core/types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown) => v === null || isStr(v);

function check(cond: boolean, path: string, errors: string[]) {
  if (!cond) errors.push(path);
}

function validateWarnings(v: unknown, path: string, errors: string[]) {
  if (!Array.isArray(v)) return errors.push(path);
  v.forEach((w, i) => check(isObj(w) && isStr(w.type) && isStr(w.text), `${path}[${i}]`, errors));
}

function validateClaim(c: unknown, path: string, errors: string[]) {
  if (!isObj(c)) return errors.push(path);
  for (const k of ["id", "text", "explanation"]) check(isStr(c[k]), `${path}.${k}`, errors);
  for (const k of ["verdict", "verdict_label", "system_state", "system_message", "missing"]) {
    check(isStrOrNull(c[k]), `${path}.${k}`, errors);
  }
  check(
    c.strength === null || (isObj(c.strength) && isStr(c.strength.level) && Array.isArray(c.strength.reasons)),
    `${path}.strength`,
    errors,
  );
  if (!Array.isArray(c.citations)) errors.push(`${path}.citations`);
  else {
    c.citations.forEach((s, i) => {
      const p = `${path}.citations[${i}]`;
      if (!isObj(s)) return errors.push(p);
      for (const k of ["source_id", "title", "publisher", "url", "excerpt"]) check(isStr(s[k]), `${p}.${k}`, errors);
      check(isStrOrNull(s.published_at), `${p}.published_at`, errors);
    });
  }
  validateWarnings(c.warnings, `${path}.warnings`, errors);
}

export type Validated = { ok: true; response: CheckResponse } | { ok: false; errors: string[] };

export function validateCheckResponse(body: unknown): Validated {
  const errors: string[] = [];
  if (!isObj(body)) return { ok: false, errors: ["$"] };
  const b = body;
  check(isStr(b.contract_version) && b.contract_version.startsWith("1."), "contract_version", errors);
  check(isStr(b.check_id), "check_id", errors);
  check(isStr(b.status), "status", errors);
  check(
    b.system_message === null || (isObj(b.system_message) && isStr(b.system_message.title) &&
      isStr(b.system_message.text)),
    "system_message",
    errors,
  );
  check(isObj(b.summary) && isStr(b.summary.text), "summary", errors);
  if (!Array.isArray(b.claims)) errors.push("claims");
  else b.claims.forEach((c, i) => validateClaim(c, `claims[${i}]`, errors));
  validateWarnings(b.warnings, "warnings", errors);
  check(Array.isArray(b.limitations) && b.limitations.every(isStr), "limitations", errors);
  check(isObj(b.escalation) && isStr(b.escalation.state), "escalation", errors);
  check(
    isObj(b.input) && isStr(b.input.type) && isStrOrNull(b.input.title) && isStrOrNull(b.input.url) &&
      isStrOrNull(b.input.description),
    "input",
    errors,
  );
  check(isObj(b.meta) && isStr(b.meta.mode), "meta", errors);
  return errors.length ? { ok: false, errors } : { ok: true, response: body as unknown as CheckResponse };
}
