/*
Hand-written baseline: things `supabase db diff` does NOT capture from schemas/ (schema privileges,
default privileges, event triggers). Decisions/001: `private` and `corpus` are server-only. No
CRUD for anon/authenticated even if a schema gets exposed by mistake.

Idempotent on purpose. When you add another statement of this kind, write a NEW hand-written
migration next to this one (never edit an applied migration).
 */
create schema if not exists private;

create schema if not exists corpus;

revoke all on schema private from public, anon, authenticated;

revoke all on schema corpus from public, anon, authenticated;

revoke all on all tables in schema private from public, anon, authenticated;

revoke all on all tables in schema corpus from public, anon, authenticated;

revoke all on all functions in schema private from public, anon, authenticated;

alter default privileges in schema private revoke all on tables from public, anon, authenticated;

alter default privileges in schema private revoke all on functions from public, anon, authenticated;

alter default privileges in schema corpus revoke all on tables from public, anon, authenticated;

-- New public functions are NOT callable via /rest/v1/rpc unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

/*
Auto-enable RLS on every new table in public, private and corpus. With RLS on and no policies,
anon and authenticated can neither read nor write. The function lives in `private`, so the Data
API never exposes it.
 */
create or replace function private.rls_auto_enable () returns event_trigger language plpgsql security definer
set search_path = pg_catalog as $$
declare
  cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name in ('public', 'private', 'corpus') then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function private.rls_auto_enable () from public, anon, authenticated;

drop event trigger if exists rls_auto_enable_trg;

create event trigger rls_auto_enable_trg on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.rls_auto_enable ();
