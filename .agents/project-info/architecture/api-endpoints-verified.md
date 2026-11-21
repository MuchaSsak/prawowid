# API endpoints: verified calls and the end-to-end flow
Exact calls we can make, **each one tested by hand with curl on 2026-11-21** (status and real response shown), plus the step-by-step request flow. Use this when writing connectors. Anything not tested is marked **Assumption**. Background: [data-sources-research.md](data-sources-research.md), [stack-research.md](stack-research.md), [multimodal-media.md](multimodal-media.md), [verification-pipeline.md](verification-pipeline.md).

## Verified endpoints
| Source | Call | Verified result | Use |
|---|---|---|---|
| **EUvsDisinfo MCP** | `POST https://euvsdisinfo-mcp-server.vercel.app/mcp` JSON-RPC `initialize`, then `tools/call` `cases`/`articles` `{offset,limit≤100}` with headers `Authorization: Bearer`, `mcp-session-id` | No token → **401** (the endpoint is alive). Full flow in [euvsdisinfo-mcp.md](euvsdisinfo-mcp.md) | Bulk ingest (needs the token) |
| **Google Fact Check** | `GET https://factchecktools.googleapis.com/v1alpha1/claims:search?query=…&languageCode=pl&key=KEY` | No key → **403 PERMISSION_DENIED** (alive, needs a key) | Live lookup + ingest |
| **OpenRouter embeddings** | `POST https://openrouter.ai/api/v1/embeddings` `{model:"baai/bge-m3",input}` | No key → **401**. `/api/v1/embeddings/models` lists **40** models incl. `baai/bge-m3`, `intfloat/multilingual-e5-large`, `mistralai/mistral-embed-2312` | Embeddings |
| **OpenRouter video/audio** | `POST /api/v1/responses` with `input_video` (URL or base64; YouTube only via Google AI Studio) / `input_audio` (base64 wav/mp3) | From the docs (not called) | Media → text |
| **CERT Polska** | `GET https://moje.cert.pl/advisories/feed/` | **200 RSS 2.0**, `language pl` | Ingest |
| **Police** | `GET https://policja.pl/dokumenty/rss/1-rss-1.rss` (also `1-rss-o-4.rss`). `/pol/rss` is only an HTML index | **200 RSS** with `<item>`s | Ingest |
| **IMGW warnings** | `GET https://danepubliczne.imgw.pl/api/data/warningsmeteo` (also `warningshydro`) | **200 JSON**: `nazwa_zdarzenia, stopien, prawdopodobienstwo, obowiazuje_od/do, opublikowano, tresc` | Ingest + live ("Is there a storm warning?") |
| **IMGW synop** | `GET https://danepubliczne.imgw.pl/api/data/synop/station/warszawa` | **200 JSON**: `temperatura, data_pomiaru, …` | Live weather facts |
| **gov.pl** (RCB, MSZ, GIS…) | List: `GET https://www.gov.pl/web/{unit}/{list}?page=N&size=N`. Article: `GET https://www.gov.pl/web/{unit}/{slug}` | robots.txt **`Allow: /`**. Articles have `<p class="event-date">DD.MM.YYYY` + `<meta name="description">`. List pages render server-side `<a href="/web/rcb/…">` items with `class="date"` and `div.title` | Scrape-ingest (HTML) |
| **Sejm ELI (laws)** | `GET https://api.sejm.gov.pl/eli/acts/search?title=…&limit=N`; text: `GET /eli/acts/DU/{year}/{pos}/text.html` | **200 JSON**: `displayAddress, title, status ("obowiązujący"), announcementDate, promulgation, entryIntoForce, inForce`. Text → **200 text/html** | Live legal lookup |
| **Sejm votings** | `GET https://api.sejm.gov.pl/sejm/term10/votings/{sitting}` and `/votings/{sitting}/{no}` | **200 JSON**: `title, date, yes/no/abstain, majorityVotes, links.pdf` | Live "X voted for Y" |
| **GUS BDL** | Search: `GET https://bdl.stat.gov.pl/api/v1/variables/search?name=…&format=json`. Value: `GET /api/v1/data/by-unit/000000000000?var-id=72305&year=2024&format=json` | **200**: Poland's population in 2024 = **37,489,087** (`lastUpdate` included) | Live numeric facts |
| **Eurostat** | `GET https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_a?geo=PL&age=Y15-74&unit=PC_ACT&sex=T&time=2024&format=JSON` | **200 JSON-stat**: PL unemployment in 2024 = **2.9%**, `updated` included | Live EU comparisons |
| **NBP** | `GET https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json` | **200**: EUR mid 4.4559 on 2026-11-20 | Live exchange rates |
| **dane.gov.pl** | `GET https://api.dane.gov.pl/1.4/search?q=…`, `/datasets?q=…`, `/resources?q=…&has_dynamic_data=true`, rows: `/resources/{id}/data?per_page=N` | **200** for all. Row quality **varies** (one sample had a whole CSV line in one column) | Dataset discovery + citations; numbers prefer GUS |
| **YouTube oEmbed** | `GET https://www.youtube.com/oembed?url=…&format=json` | **200**: `title, author_name` | Video metadata for citations |
| **EUR-Lex HTML** | `GET https://eur-lex.europa.eu/legal-content/PL/TXT/HTML/?uri=CELEX:…` | **202 with an empty body**, likely a bot challenge. **Don't scrape it** (no-bypass rule) | ✗ |
| **EU Cellar SPARQL** | `GET https://publications.europa.eu/webapi/rdf/sparql?query=…&format=application/sparql-results+json` | **200** | The official EU-law route instead of EUR-Lex HTML |

**Blocked or avoid:** Demagog (robots.txt disallows AI bots; use the Google Fact Check API metadata instead), EUR-Lex HTML (challenge), `gov.pl/web/gov/ostrzezenia` (JS-rendered), odyseusz.gov.pl travel advice (JS app; capture by hand). See [data-sources-research.md](data-sources-research.md).

## End-to-end flow: `POST /api/v1/check`

This endpoint sketch illustrates integration points. The [verification pipeline](verification-pipeline.md) owns claim states, evidence eligibility and verdict rules.

```
Client (web / messaging-bot adapter)
  POST /api/v1/check { input: {type:"text"|"url"|"image", value}, channel, session_id }
1. Validate + rate-limit (per IP / Discord user). Reject > size caps.
2. Normalize input
   url   → SSRF-safe GET → Readability text + published_at (meta/JSON-LD/event-date)
           + collect images, <video> mp4, YouTube iframes (oEmbed for title/author)
   image → vision model (OpenRouter) → OCR text + description
   video → YouTube URL: /responses input_video (Google AI Studio) → transcript
           mp4: download (≤50 MB, ≤10 min) → base64 → /responses → transcript   [async]
3. Guard: PII mask, injection scan (log injection_detected to check_events), wrap as untrusted
4. LLM call #1 (cheap model, JSON schema): claims[] {text, class: fact|opinion|prediction|unclear,
   type: numeric|legal|parliamentary|event|narrative, time, place, entities, search_queries (base forms)}
5. Retrieve per fact claim (in parallel)
   numeric       → GUS BDL / Eurostat / NBP / dane.gov.pl  (store response as source record)
   legal         → Sejm ELI search + text (Cellar SPARQL for EU law)
   parliamentary → Sejm votings
   event/news    → Supabase hybrid search (FTS simple+unaccent ⊕ bge-m3 vector, RRF) over
                   ingested gov.pl / CERT / police / IMGW / ClaimReview; + live Google Fact Check
   narrative     → EUvsDisinfo case match (context/warning only)
6. LLM call #2 (cheap model, JSON schema): per claim × top-5 passages → stance + exact quote
7. Code: verify quotes verbatim → drop failures → score strength → verdict rules → status
8. Compose the Polish answer (template + short model text); citations from DB by ID
9. Log the check (masked question, sources, verdicts, latency, model, usage.cost); moderator case if needed
  ← 200 { status, claims:[{text, verdict|null, strength, explanation, citations[], warnings[]}],
          limitations[], system_messages[], check_id }
  (full shape and all response types: product/response-contract.md)
```

## Ingestion jobs (separate script, plus Deno.cron for increments)
| Job | Source | Frequency | Records |
|---|---|---|---|
| euvsdisinfo_bulk | MCP `cases` paginated (~193 calls × 100) | once, local | ~19k (filter to PL/UA/EU for the demo) |
| claimreview | Google Fact Check `claims:search` over topic seeds, `languageCode=pl` | daily | 150-300 |
| cert_rss | moje.cert.pl feed | hourly | ~50 |
| police_rss | policja.pl RSS | hourly | ~20 |
| imgw_warnings | warningsmeteo/hydro | hourly | 20-50 |
| govpl_scrape | RCB, MSZ dyplomacja, GIS list pages → articles | daily | ~110 |
| (manual) | Odyseusz travel advice, NASK PDFs | once | ~15 |

Every record: `id, source_id, url, title, publisher, published_at, retrieved_at, license, lang, text, chunks[] (with embeddings), raw_ref`.
