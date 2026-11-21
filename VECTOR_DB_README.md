# Prawdowid — baza wektorowa Policji

Ten pakiet zawiera mały, gotowy do uruchomienia korpus 21 artykułów `policja.pl`, PostgreSQL z pgvector, lokalne embeddingi oraz API wyszukiwania. Nie zawiera LLM ani logiki werdyktów.

## Uruchomienie

```bash
python3 -m venv .venv
source .venv/bin/activate
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

Na pierwszym uruchomieniu kontener tworzy rozszerzenie `vector` oraz tabele `documents` i `chunks` z `infra/postgres/init.sql`.

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

## Testy

```bash
python -m pytest -q
```

## Co jest w pakiecie

- `data/corpus/policja-clean.jsonl` — 21 oczyszczonych dokumentów źródłowych;
- `infra/postgres/init.sql` — schemat PostgreSQL + pgvector;
- `scripts/ingest_corpus.py` — chunking, embeddingi i idempotentny ingest;
- `scripts/retrieval.py` — wyszukiwanie wektorowe i walidacja cytatów;
- `scripts/api.py` — `/search` i `/health`;
- `tests/` — testy kontraktu bez sieci;
- `docs/eval/smoke-queries.json` — zapytania smoke.

Plik `.env.example` jest wyłącznie szablonem. Nie wysyłaj `.env`, haseł ani katalogu `.venv`. Korpus zawiera pełne treści artykułów; przed publicznym udostępnieniem sprawdź warunki ich dalszego udostępniania.
