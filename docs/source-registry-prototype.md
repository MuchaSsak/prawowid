# Source registry prototype: run it on localhost

A working prototype of the proposal in [`.agents/project-info/architecture/source-platform.md`](../.agents/project-info/architecture/source-platform.md) (PR #12). Operators add, test, activate and disable evidence sources at `/admin/zrodla` without a deploy. Every evidence record passes one eligibility rule, and the corpus keeps document versions.

The registry is **off unless `REGISTRY_PATH` is set**. Without it the API behaves exactly as on `main`.

## Requirements

- **Deno 2.x**: `curl -fsSL https://deno.land/install.sh | sh` (or see https://docs.deno.com/runtime/getting_started/installation/). Check with `deno --version`.
- **Bun 1.3+**: https://bun.sh.
- Full tier only: Docker (or Podman with `docker compose`) and Python 3.12+.

Env vars, names only (put secrets in `.env` or your shell, never in the repo):

| Name | Needed for | Value |
|---|---|---|
| `ADMIN_TOKEN` | the admin panel and every `/api/v1/admin/*` route | any long random string you choose |
| `REGISTRY_PATH` | turns the registry on | `../../data/registry/registry.json` (relative to `apps/api`, gitignored), or `memory` |
| `PRAWDOWID_RETRIEVAL_URL` | full tier: pgvector corpus | `http://127.0.0.1:8000` |
| `POSTGRES_PORT` | full tier, if 5432 is taken | e.g. `55432` (same value for compose and uvicorn) |
| `OPENROUTER_API_KEY`, `GOOGLE_FACT_CHECK_API_KEY` | optional: real checks on the home page | your keys |

Without the LLM key, checks on the home page return a system state. Everything on `/admin/zrodla` (probe, sample, sync, upload, corpus browser) works without any key, because none of it calls the model.

## Quick tier (no Docker, no Python)

The corpus is an in-memory keyword store, saved to `data/registry/corpus.json` so it survives restarts.

```bash
bun install
# terminal 1: API on http://localhost:8787
cd apps/api
ADMIN_TOKEN=<your-token> REGISTRY_PATH=../../data/registry/registry.json deno task registry
# terminal 2: web on http://localhost:4321
bun run web:dev
```

## Full tier (pgvector)

The corpus lives in PostgreSQL + pgvector. Embeddings (`intfloat/multilingual-e5-small`) are computed by the Python retrieval service, and filters run in SQL before vector ranking.

```bash
bun install
POSTGRES_PORT=55432 docker compose up -d          # pgvector; old volumes are upgraded in place
python3 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -e '.[api,rag,dev]'
# terminal 1: retrieval service (first start downloads the embedding model)
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 .venv/bin/uvicorn scripts.api:create_app --factory --host 127.0.0.1 --port 8000
# terminal 2: API
cd apps/api
ADMIN_TOKEN=<your-token> REGISTRY_PATH=../../data/registry/registry.json \
  PRAWDOWID_RETRIEVAL_URL=http://127.0.0.1:8000 deno task registry
# terminal 3: web
bun run web:dev
```

On the first start the API seeds the registry from today's catalog (`registry: seeded …`). It then loads the 21 policja.pl documents into the corpus through the same `replace()` path in both tiers (`registry: policja corpus seed via pgvector|memory`). If the retrieval service is still loading, the API retries for about a minute.

Check what is running: `curl http://localhost:8787/api/v1/health` reports `registry.corpus_backend` (`memory` or `pgvector`). The admin page shows it too.

## Open

- http://localhost:4321/admin/zrodla: enter `ADMIN_TOKEN` and your name. The name is sent as `X-Operator` and recorded in the log.
- http://localhost:8787/api/v1/sources: the public list of active sources.

## 5-minute test script

The page has five tabs: **Źródła** (what is on), **Dodaj źródło**, **Dokumenty** (stored texts), **Test wyszukiwania** (what the sources find for a claim, without the LLM) and **Historia zmian** (who changed what).

1. **Źródła.** The ledger lists each source with where its data comes from and one switch. A fresh registry has about 20 (Sejm ELI, Eurostat, NBP, GUS, Policja.pl, Google Fact Check with its fact-checkers). The line above the tabs gives the counts and the list version.
2. **Test wyszukiwania.** Enter `operacja TOR ochrona infrastruktury kolejowej`. Policja.pl documents come back. Google Fact Check shows "brak klucza" if you have no key.
3. **Disable.** On "Źródła", switch off Policja.pl. It moves under "Wyłączone" and the list version goes up by one. Run the same search: no Policja.pl documents. Open `/api/v1/sources`: `policja` is gone. Switch it back on.
4. **Add an RSS source.** On "Dodaj źródło": type "Kanał RSS / Atom", address `https://cert.pl/rss.xml`, new publisher named `CERT Polska` with domain `cert.pl`, then "Zapisz". IDs are generated from the name (open "Więcej opcji" to change them). The source appears under "Czeka na aktywację": type `podatność`, click "1. Testuj" and check that every sample row shows ✓, then "2. Aktywuj". Back on "Źródła", click "Pobierz teraz" next to CERT Polska: about 30 items are stored. Search `podatność wstrzyknięcie komend`: CERT Polska comes back.
5. **Upload and replace.** Add a test source first, so no text is attributed to a real publisher: type "Dokumenty dodawane ręcznie", publisher `Wydawca testowy (dane fikcyjne)` with domain `example.org`, and under "Więcej opcji" set "Rodzaj dokumentów" to "Stan obowiązujący". Save and activate it (no test needed). On "Dokumenty", open "Dodaj lub zastąp dokument":
   - URL `https://example.org/ostrzezenie`, effective from `2026-03-01`, text `Podróże do Przykładowa są odradzane z powodu powodzi.`
   - Save, then click the document in the list and use "Zastąp": effective from `2026-11-20`, text `Podróże do Przykładowa są możliwe bez ograniczeń.`
6. **Versions.** On "Dokumenty", tick "Pokaż stare wersje" and open the document: v2 is current, v1 is old. On "Test wyszukiwania", `podróże Przykładowo` returns v2 for today and v1 with "Kiedy" set to `2026-05`.
7. **Historia zmian.** Every action is listed with operator and list version. Finally, switch off the test publisher so the fictional source is not live.

Reset: stop the API and delete `data/registry/` (and, in the full tier, run `docker compose down -v` to drop the corpus volume).

## What is simplified compared with the proposal

| Proposal | Prototype |
|---|---|
| Registry in server-only Supabase tables | A JSON file written atomically (temp file + rename) behind a `RegistryStore` interface, or in memory. Swapping in Supabase means one new store class. |
| Authenticated operator identities before any write | Admin bearer token plus a free-text `X-Operator` header. **Not acceptable in production.** |
| Hybrid / vector search, compared with keyword search on Polish evidence | Full tier: pgvector cosine search (e5-small, threshold 0.82), no hybrid ranking yet. Quick tier: keyword overlap on 6-letter stems. The comparison itself is still to do. |
| Coverage by capability and scope, with equivalent alternatives | Coarse capabilities per binding (`fact_check`, `legal`, `statistics`, `exchange_rate`, `population`, `documents`). |
| Request destinations limited per binding | Enforced for RSS and JSON templates (HTTPS, allowed hosts, every redirect re-checked, robots.txt, DNS private-address check, time and size caps). Builtin connectors keep their own fetch code; their `allowed_hosts` is declarative. |
| Upload only after the corpus retention policy is approved | Uploads are open to the admin token. Retention and purging are not implemented. |
| Document versions | A replaced document is re-checked only at retrieval. A version superseded between retrieval and assembly is not detected (a disabled publisher or binding is). |
| JSON templates reviewed in code | One template: WordPress REST posts search. |
| Sync status | Kept in API memory, outside the registry revision; lost on restart. |

Which backend the tests used: the Deno unit tests run on the memory corpus, with a stubbed `HttpCorpusStore` contract test. The Python tests run on fake connections, plus integration tests against a real Postgres when `PRAWDOWID_TEST_DATABASE=1`. The localhost run recorded on the wiki page used pgvector.

## Code map

- `packages/core/src/registry/`: types, seed, eligibility, validation, store, versioned corpus, constrained fetch, adapters, evidence access, ingestion.
- `packages/core/src/pipeline/check.ts`: optional `deps.registry`. The revision is pinned at check start, registry and corpus revisions are part of the cache key, and cited records are revalidated at assembly (cache hits included).
- `packages/core/src/store/http-corpus.ts`: the pgvector backend of the same corpus interface.
- `apps/api/registry-routes.ts`: admin routes (full list in the header). `apps/api/main.ts` mounts them when `REGISTRY_PATH` is set.
- `apps/web/src/pages/admin/zrodla.astro`, `apps/web/src/lib/admin/sources.ts`: the operator page.
- `infra/postgres/`, `scripts/corpus_versions.py`, `scripts/retrieval.py`, `scripts/api.py`: the versioned corpus on pgvector ([VECTOR_DB_README.md](../VECTOR_DB_README.md)).
