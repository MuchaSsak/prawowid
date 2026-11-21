# 001: Logs and internal data live in a private schema, with no public access
Date: 2026-11-21 · Status: decided (user)

Context: the brief requires a log of every check (question, time, sources, verdict) plus observability, a defined retention period, a deletable demo session and access control. Supabase exposes the `public` schema through its auto-generated REST API, so a table placed there by mistake could be read with the anon key from the web bundle.

Decision:
- The tables `private.check_logs`, `private.check_events` (injection detected, retrieval errors, quote rejections, verdict disagreements), `private.moderator_cases` and `private.sessions` live in a schema named **`private`** that is **not on the list of schemas exposed by the API** (Supabase → API settings).
- `REVOKE ALL ON SCHEMA private FROM anon, authenticated, public;` RLS is enabled on every table with **no policies**, so there is no CRUD for public roles even if the schema is exposed by mistake.
- Only the server (the Deno API, with a direct Postgres connection or the service-role key kept in env, never in the browser) reads and writes. The web app and Discord never talk to Supabase directly.
- We store only the **masked** question, and hash the Discord user ID. Retention: a `pg_cron` job deletes rows older than 30 days. `DELETE /api/session/{id}` removes a session's rows.
- The corpus tables (`corpus.documents`, `corpus.chunks`) are kept out of the API in the same way (server-only reads), because they hold full source texts (brief: archiving full content needs access control).

Rejected: logs in `public` guarded only by RLS policies (one wrong policy leaks them); a separate logging service (extra vendor, extra cost).

Affects: [architecture/stack-research.md](../architecture/stack-research.md) (it suggested `public.checks`; this decision supersedes that), [hackathon/compliance-matrix.md](../hackathon/compliance-matrix.md), [product/response-contract.md](../product/response-contract.md).
