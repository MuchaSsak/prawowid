/**
 * schema-files.mjs: which supabase/schemas/**.sql files exist, their order, and the guards they must
 * pass. Adapted from the team's earlier Supabase setup, without its multi-tenant parts. Zero deps.
 *
 * The order here MUST match `schema_paths` in supabase/config.toml (the diff applies files in that order).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPABASE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const SCHEMAS_DIR = join(SUPABASE_DIR, "schemas");
export const DIR_ORDER = ["GLOBAL", "ENUMS", "UTILS", "TABLES", "CRONS", "RPC"];

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".sql")) out.push(p);
  }
  return out;
}

export function topDir(absPath) {
  const rel = relative(SCHEMAS_DIR, absPath).replace(/\\/g, "/");
  const slash = rel.indexOf("/");
  return slash === -1 ? "." : rel.slice(0, slash);
}

export function schemaFiles() {
  const rank = (p) => {
    const i = DIR_ORDER.indexOf(topDir(p));
    return i === -1 ? DIR_ORDER.length : i;
  };
  return walk(SCHEMAS_DIR).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Refused outright: wrong layer or too dangerous for a schema file. */
export const FORBIDDEN = [
  { re: /\bdrop\s+schema\b/i, why: "`drop schema` is never allowed in schemas/" },
  { re: /\bsupabase_migrations\b/i, why: "touches the CLI migration history table" },
  { re: /\b(?:create|alter|drop)\s+role\b/i, why: "role DDL does not belong in schemas/" },
  {
    re: /\bgrant\b[^;]*\bon\s+(?:all\s+tables\s+in\s+schema|schema)\s+(?:private|corpus)\b[^;]*\bto\s+(?:anon|authenticated|public)\b/i,
    why: "grants a public role access to private/corpus (decisions/001)",
  },
  {
    re: /\bto\s+(?:anon|authenticated)\b[^;]*\busing\s*\(\s*true\s*\)/i,
    why: "a policy `using (true)` for anon/authenticated opens the whole table",
  },
];

/**
 * Not captured by `supabase db diff` (Supabase declarative-schema caveats). They would silently
 * vanish from the generated migration, so they must go into a hand-written migration instead.
 */
export const NOT_DIFFED = [
  { re: /\b(?:grant|revoke)\b[^;]*\bon\s+schema\b/i, why: "schema privileges" },
  { re: /\balter\s+default\s+privileges\b/i, why: "default privileges" },
  { re: /\bevent\s+trigger\b/i, why: "event triggers" },
  { re: /\bcomment\s+on\b/i, why: "comments" },
  { re: /^\s*(?:insert\s+into|update\s+\S+\s+set|delete\s+from)\b/im, why: "DML (data, seeds, cron schedules)" },
  { re: /\balter\s+policy\b/i, why: "alter policy (drop + create it instead)" },
];

export const DESTRUCTIVE =
  /\b(?:drop\s+(?:table|function|view|materialized\s+view|trigger|policy|type|index|sequence|column)|truncate|delete\s+from|alter\s+table\s+[^\n;]*\bdrop\b)/i;

export function scanFile(path) {
  const sql = stripComments(readFileSync(path, "utf8"));
  const violations = [];
  const notDiffed = [];
  for (const { re, why } of FORBIDDEN) if (re.test(sql)) violations.push(why);
  for (const { re, why } of NOT_DIFFED) if (re.test(sql)) notDiffed.push(why);
  return { violations, notDiffed };
}

/** Lines of a SQL text that drop or delete something (for review output). */
export function destructiveLines(sql) {
  return sql
    .split(/\r?\n/)
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => DESTRUCTIVE.test(text.replace(/--.*$/, "")));
}
