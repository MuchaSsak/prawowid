# Plan integracji bazy wektorowej
Plan wpięcia istniejącego prototypu PostgreSQL + pgvector do Prawdomatu przy minimalnych zmianach.

Status: Etap 0 i podstawowy Etap 1 są zaimplementowane lokalnie; pełny test wymaga zainstalowania
zależności Python oraz Deno/Bun zgodnie z README.

## Stan obecny

- `scripts/ingest_corpus.py` i `scripts/retrieval.py` tworzą oraz przeszukują `documents`/`chunks` w PostgreSQL z `pgvector`.
- `scripts/api.py` wystawia `/health` i `/search`; zwraca literalny fragment tekstu, offsety, URL, tytuł, daty i score.
- `packages/core` ma już właściwy punkt rozszerzenia: `CorpusStore.search()` i `CorpusStore.upsert()`.
- `corpusSearch` jest już podłączony do `CONNECTORS`, ale obecnie dostaje `MemoryCorpusStore`, który używa prostego overlapu słów.
- Kontrakt `/api/v1/check` nie wymaga zmiany. Korpus jest trasą opcjonalną, więc brak bazy nie może stać się werdyktem.
- `docker-compose.yml` nie występuje obecnie w repo, mimo że `VECTOR_DB_README.md` opisuje `docker compose up -d`; trzeba to naprawić przed użyciem instrukcji jako setupu.

## Zrealizowany wariant: cienki adapter HTTP

Python pozostaje osobnym retrieval service, a embedder nie został przepisany do Deno.

1. Dodać `HttpCorpusStore` w `packages/core/src/store/` implementujący istniejący `CorpusStore`.
2. Adapter wysyła `POST {PRAWDOWID_RETRIEVAL_URL}/search` z połączonymi zapytaniami (`claim.text` + `search_queries_pl`), `k=5`.
3. Wyniki mapuje na istniejący `SourceRecord`: `source_id` z `document_id/chunk_id`, `route: "corpus"`, `tier: "official"` tylko dla jawnie skonfigurowanych źródeł, literalny `quoted_text` jako `text`, oraz metadane dokumentu.
4. `apps/api/main.ts` wybiera `HttpCorpusStore`, gdy ustawiono URL; w przeciwnym razie zostawia `MemoryCorpusStore`. To jest jedyna zmiana wiringowa aplikacji.
5. Dodać timeout, abort przez `ctx.signal`, walidację odpowiedzi i mapowanie błędów na `ConnectorError`/status opcjonalnej trasy. Awaria retrievalu ma dać ograniczenie techniczne, nie werdykt.
6. Dodać `PRAWDOWID_RETRIEVAL_URL` do `.env.example` jako ustawienie niebędące sekretem oraz `/api/v1/health` z informacją `corpus: configured/unconfigured` bez ujawniania DSN.

## Kolejność wdrożenia

### Etap 0 — uruchamialność prototypu

- Uzupełnić brakujący `docker-compose.yml` albo skorygować README do faktycznego sposobu uruchamiania PostgreSQL.
- Naprawić test/ścieżkę health w Python API (`HTTPException` nie jest importowane).
- Uruchomić ingest 21 dokumentów i test kontraktu `/search`.

### Etap 1 — integracja bez zmiany pipeline’u

- Dodać adapter `HttpCorpusStore` i testy z fake `fetch`.
- Włączyć go przez zmienną środowiskową; default pozostaje in-memory.
- Przetestować: hit, pusty wynik, timeout, 500 serwisu, błędny JSON, literalny cytat i zachowanie bez konfiguracji.

### Etap 2 — jakość i bezpieczeństwo dowodu

- Nie uznawać samego score za dowód; model nadal ocenia stance, a kod nadal waliduje cytat i zakres.
- Dodać jawne mapowanie allowlisty źródeł, zamiast ufać `publisher` zwróconemu przez usługę.
- Dodać `embedding_model_id`, threshold i snapshot indeksu do diagnostyki/replay, nie do publicznego kontraktu.
- Porównać benchmark keyword-only vs vector na istniejących evalach; dopiero wynik uzasadnia włączenie retrievalu jako domyślnego.

### Etap 3 — docelowe przeniesienie do Supabase

Jeżeli osobny Python service będzie problemem operacyjnym, przenieść tabele do `corpus` w Supabase i wystawić prywatną funkcję/RPC retrievalu. Wtedy adapter `CorpusStore` pozostaje taki sam, a zmienia się tylko jego implementacja. `packages/core` nie powinien zależeć od biblioteki Python.

## Dlaczego nie zmieniać teraz core

- Interfejs `CorpusStore` już izoluje storage.
- `corpusSearch` już działa jako opcjonalny connector.
- `SourceRecord` jest wspólnym formatem dla oceny, cytatów i logowania.
- Bezpośrednie połączenie Deno → PostgreSQL zwiększyłoby zależności, sekrety i ryzyko migracji, a nie dałoby teraz przewagi jakościowej.
- Osobny FastAPI service jest kompromisem przejściowym; Supabase pozostaje docelowym miejscem, zgodnie z istniejącą architekturą.

## Otwarte decyzje przed implementacją

- Czy środowisko docelowe może uruchamiać osobny kontener Python, czy od razu wymagany jest Supabase/Edge Function?
- Jaki poziom źródeł ma mieć `policja.pl` w allowliście (`official` vs osobna polityka źródeł instytucjonalnych)?
- Czy publiczny corpus może przechowywać pełne teksty przy obecnym `license_status: conditional` i jaką przyjąć retencję?
- Czy po benchmarku wdrażamy samo vector search, czy hybrydę FTS + vector/RRF?

