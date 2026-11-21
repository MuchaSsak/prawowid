/*
Extensions and schemas the whole project needs. Declarative: `supabase db diff` turns this into a
migration (supabase/README.md). Write it idempotently anyway, so a local re-apply never fails.

- private: logs, events, sessions, moderator cases (decisions/001). Never exposed by the Data API.
- corpus:  ingested source documents and chunks (full texts need access control). Never exposed.
- vector, pg_trgm, unaccent: hybrid retrieval later (FTS + pgvector).
- pg_cron: retention job (30 days, decisions/001).
 */
create schema if not exists extensions;

create schema if not exists private;

create schema if not exists corpus;

create extension if not exists pg_trgm schema extensions;

create extension if not exists unaccent schema extensions;

create extension if not exists vector schema extensions;

create extension if not exists pg_cron;
