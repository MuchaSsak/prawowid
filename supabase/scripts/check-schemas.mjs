/**
 * Static guard over supabase/schemas/ (no database needed). Run before generating a migration and in CI.
 *   node supabase/scripts/check-schemas.mjs
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { DIR_ORDER, schemaFiles, scanFile, SUPABASE_DIR, topDir } from "./schema-files.mjs";

const files = schemaFiles();
const config = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
let failed = false;

for (const dir of DIR_ORDER) {
  if (!config.includes(`./schemas/${dir}/*.sql`)) {
    console.log(`\x1b[31m✗ config.toml schema_paths is missing ./schemas/${dir}/*.sql\x1b[0m`);
    failed = true;
  }
}

for (const f of files) {
  const rel = relative(SUPABASE_DIR, f).replace(/\\/g, "/");
  const dir = topDir(f);
  const { violations, notDiffed } = scanFile(f);
  console.log(`  • ${rel}`);
  if (!DIR_ORDER.includes(dir)) {
    console.log(`      \x1b[31m✗ folder "${dir}" is not in DIR_ORDER / config.toml schema_paths\x1b[0m`);
    failed = true;
  }
  for (const v of violations) {
    console.log(`      \x1b[31m✗ REFUSED: ${v}\x1b[0m`);
    failed = true;
  }
  for (const n of notDiffed) {
    console.log(`      \x1b[31m✗ ${n}: \`supabase db diff\` ignores this. Move it to a hand-written migration.\x1b[0m`);
    failed = true;
  }
}

if (failed) {
  console.error("\nSchema check failed (see ✗ above).");
  process.exit(1);
}
console.log(`\nSchema check OK (${files.length} file${files.length === 1 ? "" : "s"}).`);
