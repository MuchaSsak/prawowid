# 005: Supabase is built from `supabase/schemas/`; migrations are generated, never hand-edited
Date: 2026-11-21 · Status: decided (user)

Context: the user wants the Supabase project structured locally the way their earlier project does it: `schemas/` as the ultimate source of truth, migrations generated automatically, edge functions in `functions/`. The scripts may be reused, but not that project's tables, and not its multi-tenant (`p_*` schema) parts.

Decision:
- `supabase/schemas/{GLOBAL,ENUMS,UTILS,TABLES,CRONS,RPC}/*.sql` is the source of truth. The order is set in `config.toml` `schema_paths` and mirrored in `scripts/schema-files.mjs`.
- One deploy path: `supabase db diff` (local Docker shadow DB) generates a migration → review (destructive lines in red) → commit → `supabase db push` after typing `yes` (`scripts/migrate.mjs`). The earlier project's second path (re-applying schema files through the Management API) is dropped: two paths collide.
- Statements the diff ignores (schema privileges, default privileges, event triggers, comments, DML, `alter policy`) are refused in `schemas/` by `scripts/check-schemas.mjs` and go into hand-written migrations, starting with `20261121000000_baseline_privileges.sql` (private/corpus locked down, RLS auto-enable).
- Additive changes only; `private` and `corpus` stay unexposed ([decision 001](001-private-logs-schema.md)); never enable Supabase's GitHub production integration.

Rejected: path A (idempotent re-apply via Management API): no migration history, and it collides with generated migrations; copying the old project's tables or tenant scripts (not our domain).

Affects: [supabase/README.md](../../../supabase/README.md), [architecture/codebase.md](../architecture/codebase.md).
