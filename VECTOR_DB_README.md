# Prawdowid — baza wektorowa Policji

Ten pakiet zawiera mały, gotowy do uruchomienia korpus 21 artykułów `policja.pl`, PostgreSQL z pgvector, lokalne embeddingi oraz API wyszukiwania. Nie zawiera LLM ani logiki werdyktów.

## Uruchomienie

```bash
python3 -m venv .venv
source .venv/bin/activate
# CPU-only torch first (avoids multi-GB CUDA downloads); działa też na Pythonie 3.14
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e '.[api,rag,dev]'
docker compose up -d
```

Jeśli port `5432` jest zajęty, uruchom bazę na innym porcie i używaj tej samej wartości przy ingest/API:

```bash
POSTGRES_PORT=55432 docker compose up -d
export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT=55432
export POSTGRES_DB=knowledge_base_main
export POSTGRES_USER=knowledge_base
export POSTGRES_PASSWORD=knowledge_base_local_only
```

## Test z głównym API Prawdomatu

Po uruchomieniu bazy i ingestu uruchom retrieval service:

```bash
uvicorn scripts.api:create_app --factory --host 127.0.0.1 --port 8000
```

W drugim terminalu wskaż ten serwis głównemu API:

```bash
export PRAWDOWID_RETRIEVAL_URL=http://127.0.0.1:8000
bun run api:dev
```

`apps/api` użyje wtedy `HttpCorpusStore`. Bez `PRAWDOWID_RETRIEVAL_URL` zachowuje dotychczasowy
`MemoryCorpusStore`. Stan połączenia można sprawdzić przez `GET /api/v1/health`, a samą bazę przez
`POST http://127.0.0.1:8000/search`.

Przy zmianie portu użyj jednej wartości we wszystkich procesach, np. `POSTGRES_PORT=55433`.

Na pierwszym uruchomieniu kontener tworzy rozszerzenie `vector` oraz tabele `documents`, `chunks` i `corpus_meta` z `infra/postgres/init.sql`, a potem uruchamia `infra/postgres/migrations/002-versioned-corpus.sql` (no-op na świeżym wolumenie).

### Migracja starego wolumenu

`002-versioned-corpus.sql` jest idempotentna: dodaje kolumny wersjonowania (`publisher_id`, `binding_id`, `kind`, `status`, `effective_from`, `effective_to`, `superseded_at`, `test_data`), usuwa stare `UNIQUE (document_id, content_hash)`, oznacza starsze wersje jako `superseded`, zakłada `documents_one_current_idx` (jedna wersja `current` na `document_id`) i tabelę `corpus_meta`. Skrypty init uruchamiają się tylko na pustym wolumenie, więc migrację wykonuje też samo API przy starcie (i `scripts.ingest_corpus`) — stary wolumen nie wymaga czyszczenia. Ręcznie:

```bash
docker exec -i prawowid-vector-db psql -U knowledge_base -d knowledge_base_main < infra/postgres/migrations/002-versioned-corpus.sql
```

Montowania w `docker-compose.yml` mają flagę `z` (SELinux, np. Fedora + podman); bez niej skrypty init dostają `Permission denied`. Nazwa wolumenu zależy od katalogu projektu compose, więc każdy worktree ma osobną bazę.

## Wczytanie 21 dokumentów

```bash
python -m scripts.ingest_corpus --input data/corpus/policja-clean.jsonl
```

Pierwsze uruchomienie pobiera lokalnie model `intfloat/multilingual-e5-small` (384 wymiary). Kolejne uruchomienie tych samych danych jest idempotentne i powinno raportować `unchanged=21`.

## API

```bash
uvicorn scripts.api:create_app --factory --host 127.0.0.1 --port 8000
```

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"operacja TOR bezpieczeństwo kolei","k":3}'
```

`/search` zwraca ranking chunków, metadane i dosłowny fragment tekstu wraz z offsetami. Pusty wynik oznacza brak dopasowania powyżej progu, a nie awarię; obecny próg to `0.82` i można go zmienić przez `PRAWDOWID_RETRIEVAL_THRESHOLD`.

### Wersjonowany korpus (rejestr źródeł)

| Endpoint | Co robi |
|---|---|
| `GET /health` | jak wcześniej + `corpus_revision`, `schema: "versioned"` |
| `GET /revision` | `{"corpus_revision": n}`; rośnie o 1 na każdy batch `/documents`, który coś zmienił |
| `POST /search` | bez `publisher_ids`/`binding_ids`: tryb legacy (tylko wersje `current`). Z nimi: filtr wydawca/binding + reguła wersji w `WHERE` **przed** rankingiem; pusta lista = brak wyników. `mode` `today` (domyślnie, `today` = data serwera) lub `historical` (wymaga `claim_period {start,end}`), `freshness: [{binding_id, days}]` → `stale: true`. `k` 1..20 |
| `POST /documents` | `{"documents": [...]}` w jednej transakcji: `new` / `unchanged` / `changed` (nowa wersja, poprzednia `superseded`) / `adopted` (wiersz legacy z tym samym tekstem dostaje pola rejestru). Błędy walidacji → 400 `{"errors": [...]}` i nic nie jest zapisane |
| `GET /documents` | `publisher_id`, `binding_id`, `q`, `date` (wersje ważne tego dnia, także `superseded`), `include_superseded=1`, `limit` (≤500); bez tekstu |
| `GET /documents/{document_id}/versions` | wszystkie wersje z tekstem, najnowsza pierwsza; 404 gdy brak |

Reguła ważności: `valid_from = coalesce(effective_from, published_at::date, retrieved_at::date)` (daty z timestampów w UTC), `valid_to = coalesce(effective_to, valid_from następnej wersji − 1 dzień)`. `dated_statement` zawsze wersja `current`; `standing_state` w `today` — `current`, jeśli już obowiązuje i nie wygasła; w `historical` — najwyższa wersja, której okno nachodzi na `claim_period`. Implementacja referencyjna w Pythonie: `scripts/corpus_versions.py:select_version`.

```bash
curl -X POST http://127.0.0.1:8000/documents -H 'Content-Type: application/json' -d '{"documents":[{
  "document_id":"upload:policja:abc","publisher_id":"policja","binding_id":"policja_upload",
  "kind":"dated_statement","title":"Komunikat","canonical_url":"https://policja.pl/x",
  "published_at":"2026-11-21T08:00:00+01:00","text":"Pełny tekst komunikatu.","test_data":true}]}'
curl -X POST http://127.0.0.1:8000/search -H 'Content-Type: application/json' \
  -d '{"query":"komunikat","publisher_ids":["policja"],"binding_ids":["policja_upload"],"mode":"today"}'
```

## Testy

```bash
python -m pytest -q
# testy na prawdziwej bazie (pomijane bez zmiennej; sprzątają dokumenty `itest:*`):
PRAWDOWID_TEST_DATABASE=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 python -m pytest -q tests/test_corpus_integration.py
```

## Co jest w pakiecie

- `data/corpus/policja-clean.jsonl` — 21 oczyszczonych dokumentów źródłowych;
- `infra/postgres/init.sql` — schemat PostgreSQL + pgvector;
- `infra/postgres/migrations/002-versioned-corpus.sql` — idempotentna migracja do wersjonowanego korpusu;
- `scripts/corpus_versions.py` — wersje dokumentów, batch `/documents`, lista, historia, `corpus_revision`;
- `scripts/ingest_corpus.py` — chunking, embeddingi i idempotentny ingest;
- `scripts/retrieval.py` — wyszukiwanie wektorowe i walidacja cytatów;
- `scripts/api.py` — `/search`, `/health`, `/revision`, `/documents`, `/documents/{id}/versions`;
- `tests/` — testy kontraktu bez sieci;
- `docs/eval/smoke-queries.json` — zapytania smoke.

Plik `.env.example` jest wyłącznie szablonem. Nie wysyłaj `.env`, haseł ani katalogu `.venv`. Korpus zawiera pełne treści artykułów; przed publicznym udostępnieniem sprawdź warunki ich dalszego udostępniania.
