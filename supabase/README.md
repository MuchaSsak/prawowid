# Supabase: how the database is built

Not connected yet: the app runs on an in-memory mock (`packages/core/src/store/memory.ts`). This folder holds the workflow we will use once the Supabase project exists.

## Rules
- **`schemas/` is the source of truth.** Never edit the database by hand, never run ad-hoc SQL against the remote, never enable Supabase's GitHub "deploy to production" integration.
- **Migrations are generated** from `schemas/` with `supabase db diff` (local Docker shadow DB), reviewed, committed, then pushed. Never edit a migration that was already pushed.
- **Edge functions** live in `functions/<name>/index.ts`, deployed with `bun run supabase:deploy:edge`.
- **Only add things.** Removing or altering a column is an explicit statement you write and review.
- **Security defaults** (decisions/001): `private` (logs, events, sessions, cases) and `corpus` (source texts) are server-only and never exposed by the Data API. Every new table gets RLS automatically; with no policies, anon/authenticated get nothing. Never write `to anon|authenticated using (true)`. New public functions are not callable via `/rest/v1/rpc` unless granted. The service-role key stays server-side.

## Layout
| Path | What |
|---|---|
| `schemas/GLOBAL` | extensions and schemas |
| `schemas/ENUMS`, `UTILS` | types, helper functions |
| `schemas/TABLES/<Name>.sql` | one table per file: table, indexes, triggers, its policy helpers, policies |
| `schemas/CRONS`, `RPC` | cron jobs, callable functions |
| `migrations/` | generated (plus hand-written ones for things the diff ignores) |
| `functions/` | edge functions |
| `scripts/` | the guarded scripts below |

The folder order is load-bearing and must match `schema_paths` in `config.toml`.

## What `supabase db diff` ignores
Schema privileges (`grant/revoke … on schema`), `alter default privileges`, event triggers, `comment on`, DML (seeds, `cron.schedule`), `alter policy`. `check-schemas.mjs` refuses these in `schemas/`. Put them in a hand-written migration, like `migrations/20261121000000_baseline_privileges.sql`.

## Adding a table
1. Write `schemas/TABLES/<PascalName>.sql`: a header (who writes it, who reads it), then the table, indexes, triggers, RLS policies, grants. Keep a table, the helper functions its policies call, and its policies in one file.
2. `bun run supabase:schemas:check`: static guards.
3. `bun run supabase:migration <name>`: generates the migration with Docker and prints it, destructive lines in red. Review it.
4. Commit, then `bun run supabase:push`: shows pending migrations, asks for `yes`, runs `supabase db push`.
5. Update the wiki (`architecture/`) and the store adapter in `packages/core/src/store/`.

## First-time setup (later)
1. Create the project in the EU (Frankfurt).
2. Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` to the repo-root `.env`.
3. `supabase link --project-ref <ref>`, then `bun run supabase:push` (applies the baseline).
4. In the dashboard, keep `private` and `corpus` out of the exposed schemas (API settings).
