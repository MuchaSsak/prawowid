/**
 * The ONE way the database changes. schemas/ is the source of truth; migrations are generated.
 *
 *   node supabase/scripts/migrate.mjs --generate [name]   1. static guard (check-schemas)
 *                                                       2. `supabase db diff -f <name>` against a local
 *                                                          shadow database (Docker; nothing remote)
 *                                                       3. prints the new migration, destructive lines in red
 *   node supabase/scripts/migrate.mjs --push              shows pending migrations, asks for "yes",
 *                                                       then `supabase db push` to the linked project
 *
 * Needs: Docker running (generate), and for push a linked project: `supabase link --project-ref <ref>`
 * with SUPABASE_ACCESS_TOKEN / SUPABASE_DB_PASSWORD in the repo-root .env (read by the CLI itself,
 * never passed as flags). Never run raw SQL against the remote and never enable Supabase's GitHub
 * "deploy to production" integration: it would bypass this review.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { destructiveLines, SUPABASE_DIR } from "./schema-files.mjs";

const REPO_ROOT = join(SUPABASE_DIR, "..");
const MIGRATIONS = join(SUPABASE_DIR, "migrations");
const args = process.argv.slice(2);

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
}

function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

function printSql(file) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const bad = new Set(destructiveLines(sql).map((d) => d.line));
  console.log(`\n── ${file} ──`);
  sql.split(/\r?\n/).forEach((line, i) => {
    const n = String(i + 1).padStart(4);
    console.log(bad.has(i + 1) ? `\x1b[31m${n}  ${line}\x1b[0m` : `${n}  ${line}`);
  });
  if (bad.size) console.log(`\x1b[31m${bad.size} destructive line(s) above. Read them before pushing.\x1b[0m`);
}

if (args.includes("--generate")) {
  const name = args.find((a) => !a.startsWith("--")) ?? "auto";
  if (!/^[a-z0-9_]+$/.test(name)) {
    console.error("Migration name: lowercase letters, digits and _ only.");
    process.exit(1);
  }
  run("node", [join(SUPABASE_DIR, "scripts", "check-schemas.mjs")]);
  const before = new Set(migrationFiles());
  run("supabase", ["db", "diff", "-f", name]);
  const created = migrationFiles().filter((f) => !before.has(f));
  if (created.length === 0) console.log("\nNo schema changes: no migration generated.");
  for (const f of created) printSql(f);
  console.log("\nReview it, commit it, then: bun run supabase:push");
} else if (args.includes("--push")) {
  run("supabase", ["migration", "list"]);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nPush pending migrations to the LINKED REMOTE project? Type yes: ");
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("Aborted. Nothing was pushed.");
    process.exit(0);
  }
  run("supabase", ["db", "push"]);
} else {
  console.log("Usage: node supabase/scripts/migrate.mjs --generate [name] | --push");
  process.exit(1);
}
