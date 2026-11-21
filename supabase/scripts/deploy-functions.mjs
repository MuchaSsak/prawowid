/**
 * Deploy every edge function under supabase/functions/<name>/index.ts to the linked project.
 *   node supabase/scripts/deploy-functions.mjs [name…]
 * Function secrets are set with `supabase secrets set`, never committed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SUPABASE_DIR } from "./schema-files.mjs";

const dir = join(SUPABASE_DIR, "functions");
const wanted = process.argv.slice(2);
const names = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "index.ts")))
  .map((d) => d.name)
  .filter((n) => wanted.length === 0 || wanted.includes(n));

if (names.length === 0) {
  console.log("No edge functions to deploy.");
  process.exit(0);
}
for (const name of names) {
  console.log(`Deploying ${name}…`);
  const r = spawnSync("supabase", ["functions", "deploy", name], {
    cwd: join(SUPABASE_DIR, ".."),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
