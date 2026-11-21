# Data sources: research and corpus plan

Scope: how practical each candidate source is to ingest for the Prawdomat 24h MVP (access, robots/terms, license, dates, fact-checking value), plus a concrete corpus plan that meets ≥100 documents, ≥10 domains and ≥2 source types. Researched 2026-11-21.

## Summary table

| Source | Type | Access method | License / terms | Dates available | Effort | Priority |
|---|---|---|---|---|---|---|
| EUvsDisinfo cases + articles (MCP) | Secondary: known-incidents corpus (EEAS East StratCom) | MCP streamable HTTP, bearer token, tools `cases` / `articles`, offset + limit ≤100 | No explicit license found; organizer-provided access. **Assumption**: reuse with attribution and a link back is acceptable for the demo | Case `date` (unix), article `dateGmt` | Low (about 200 paginated calls for all 19,873 cases (2026-11-21)) | **P0** |
| Google Fact Check Tools API (`claims:search`) | Secondary: fact-checkers (ClaimReview) | REST + API key, `languageCode=pl`, `reviewPublisherSiteFilter` | Google APIs ToS; the returned items link to publisher-owned articles | `claimDate`, `reviewDate` | Low | **P0** |
| CERT Polska komunikaty | Primary: official (cyber, phishing, fake messages) | RSS `https://moje.cert.pl/advisories/feed/` | **Assumption**: public advisories, quotation with attribution | Date + reference number per item | Very low | **P0** |
| gov.pl: RCB (komunikaty, Alert RCB, raport dobowy) | Primary: official (crisis, civil protection) | HTML list pages, predictable `?page=N&size=10`; no RSS found | gov.pl text: **CC BY-SA 4.0** (photos/video CC BY-NC-ND 4.0) | Date shown per item | Low | **P0** |
| gov.pl: GIS ostrzeżenia | Primary: official (food and product safety) | HTML list `https://www.gov.pl/web/gis/ostrzezenia?page=N&size=10` | CC BY-SA 4.0 | DD.MM.YYYY per item | Low | **P1** |
| gov.pl: other ministries (CIR, MSZ, MON, MZ komunikaty) | Primary: official | Same gov.pl HTML pattern | CC BY-SA 4.0 | Date per item | Low | **P1** |
| Polish fact-checkers directly (Demagog, Konkret24, AFP Sprawdzam, OKO.press, FakeHunter) | Secondary: fact-checkers | RSS (Demagog `https://demagog.org.pl/feed/sharefeed`), HTML; Demagog returned HTTP 403 to automated fetches | All rights reserved; Demagog robots.txt: `ai-train=no, use=reference`, many AI bots disallowed | Publication date in HTML / RSS | Medium (bot protection, terms) | **P1** via Google FCT metadata, direct only where allowed |
| IMGW-PIB API | Primary: official (weather, hydrology warnings) | JSON `https://danepubliczne.imgw.pl/api/data/warningsmeteo`, `/warningshydro`, `/synop`, `/hydro` | Open, attribution required (IMGW regulamin); free for non-commercial use | Warning validity and publication times. **Assumption** on exact field names | Very low | **P1** |
| Sejm ELI API (ISAP) | Primary: legal | REST `https://api.sejm.gov.pl/eli/...`, JSON + HTML/PDF text | Official acts are not protected by copyright (art. 4 of the Polish copyright act) | `announcementDate`, `promulgation`, `entryIntoForce`, `changeDate` | Low | **P1** |
| policja.pl | Primary: official (police news) | RSS `https://policja.pl/pol/rss` | **Assumption**: public information, quotation with attribution | RSS `pubDate` | Very low | **P1** |
| EUR-Lex / Cellar | Primary: legal (EU law, sanctions regulations) | SPARQL `https://publications.europa.eu/webapi/rdf/sparql`, Cellar REST, HTML by CELEX | Reuse allowed with attribution (Commission Decision 2011/833/EU) | Date of document, OJ publication, entry into force | Medium (SPARQL) | **P2** |
| EU Financial Sanctions consolidated list (FSF) | Primary: official (source-status warning) | XML/CSV download from the FSF portal (EU Login, per-user download link); mirror at OpenSanctions | EU data, free. OpenSanctions mirror is **CC BY-NC 4.0** (non-commercial only) | List generation date, regulation dates per entry | Medium | **P2** (feature, not corpus) |
| dane.gov.pl API | Primary: national open-data catalog (thousands of institutions) | REST JSON:API `https://api.dane.gov.pl/1.4/` (search, datasets, resources; tabular resources queryable; docs `/doc`), no key. **Verified live 2026-11-21** | Per-dataset license in metadata | `created`, `modified`, `resource_modified` | Low-Medium | **P1** (live lookup for statistical claims) |
| GUS BDL (Bank Danych Lokalnych) | Primary: official statistics | REST `https://bdl.stat.gov.pl/api/v1/` (subjects, variables, data by unit/year), JSON, no key (optional key raises limits). **Verified live 2026-11-21** | Public statistics, attribution to GUS | year per value | Medium | **Live route since 2026-11-21 (optional)** |
| NBP API | Primary: exchange rates, gold | REST `https://api.nbp.pl/api/`, JSON, no key. **Verified live 2026-11-21** | Open, attribution | `effectiveDate` | Low | **Live route since 2026-11-21** |
| Eurostat API | Primary: EU statistics (cross-country claims) | REST `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}`, JSON-stat, no key. **Verified live 2026-11-21** | Free reuse with attribution | time dimension | Medium | **Live route since 2026-11-21** |
| Sejm API (parliament) | Primary: MPs, votings, proceedings, interpellations | REST `https://api.sejm.gov.pl/sejm/term10/...`, JSON, no key. **Verified live 2026-11-21** | Public information | dates per voting/sitting | Low-Medium | P1 (claims like "X voted for Y") |
| NASK disinformation reports | Primary/official analysis | PDFs on `https://nask.pl/media/...`; news on gov.pl/web/cyfryzacja | **Assumption**: public reports, quotation with attribution | Report publication date | Low (a few PDFs) | **P2** |
| EDMO / CEDMO | Secondary: fact-check aggregation, briefs | EDMO fact-checking repository (web table), CEDMO briefs (HTML/PDF) | Not verified | Brief dates | Medium | **P3** |
| Check First | Secondary: research (Pravda network, Portal Kombat) | Reports + datasets on `https://checkfirst.network/` | No license found on the site | Report dates | Medium | **P3** |
| GIOŚ air quality API | Primary: data | REST `https://api.gios.gov.pl/pjp-api/...` (old `/rest/` services being withdrawn in 2025) | Open public data | Measurement timestamps | Low | **P3** |
| GDDKiA, BIP | Primary | GDDKiA traffic pages / data; BIP is decentralized per institution | Public information | Varies | High for low value | **P3 / skip** |
| odyseusz.gov.pl (MSZ travel advice) | Primary: official (foreign affairs) | `gov.pl/web/dyplomacja/informacje-dla-podrozujacych` now redirects (302) to `https://odyseusz.gov.pl/`, a JS app | gov.pl CC BY-SA 4.0. **Assumption**: same applies to Odyseusz | **Assumption**: "last updated" per country | Medium (JS rendering) | **P2** (high MSZ relevance, try a few countries by hand) |

## Details per source

### 1. Google Fact Check Tools API

- Endpoint: `GET https://factchecktools.googleapis.com/v1alpha1/claims:search` (docs: https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search).
- Auth: an API key from a Google Cloud project with the "Fact Check Tools API" enabled (https://developers.google.com/fact-check/tools/api). Keep the key in `.env` and out of the repo.
- Parameters: `query` (required unless `reviewPublisherSiteFilter` is set), `languageCode` (BCP-47, e.g. `pl`), `maxAgeDays`, `pageSize` (default 10), `pageToken`, `reviewPublisherSiteFilter` (e.g. `demagog.org.pl`).
- Response: `claims[]` with `text`, `claimant`, `claimDate`, and `claimReview[]` holding `publisher{name, site}`, `url`, `title`, `reviewDate`, `textualRating`, `languageCode`. That covers the citation fields the brief asks for (title, publisher, date, link) except the excerpt, which can be `claim.text` plus `textualRating`.
- Cost and quota: free; subject to the Google APIs ToS. **Assumption**: the default daily quota (visible in the Cloud Console quotas page) is far above what the MVP needs (hundreds of calls).
- Polish coverage: **Assumption**, to verify with a first call. AFP (incl. Sprawdzam) publishes ClaimReview systematically, and Demagog very likely does. Konkret24, OKO.press and FakeHunter are uncertain. Test with `reviewPublisherSiteFilter` for each domain: `sprawdzam.afp.com`, `demagog.org.pl`, `konkret24.tvn24.pl`, `oko.press`, `fakehunter.pap.pl`.
- Value: very high. Structured verdicts with dates and links, from IFCN/EFCSN members (Demagog: EFCSN verified 2023, https://members.efcsn.com/organization/demagog; AFP: EFCSN verified 2024). We store only metadata plus a short excerpt, so publisher copyright is not a problem.

### 2. EUvsDisinfo (MCP server and alternatives)

- MCP: `https://mcp.euvsd.info/mcp` (moved from the old vercel host, see [euvsdisinfo-mcp.md](euvsdisinfo-mcp.md)), streamable HTTP, key via `?key=`, Bearer or `X-API-Key`. Stateless `tools/call` works without `initialize`. Tools `cases`, `articles` `{offset, limit≤100}`, plus `search` and `narratives`. Totals: 19,873 cases (2026-11-21) and 6,800+ articles. A full pull is about 193 + 68 calls.
- Case fields: `id`, `title`, `claim`, `fact` (debunk), `date` (unix seconds), `keywords[]`, `countries[]`, `linksToDisinformation[]` (url, archiveUrl, snapShotURL, headLine, language), `url` (euvsdisinfo.eu/report/...). Article fields: `id`, `title`, `content`, `dateGmt`, `categories`, `articleLanguage`, `url`.
- Value: the core of the "match against known incidents" bonus. Cases are multilingual (claim language via `linksToDisinformation.language`), so they also support the multilingual-retrieval bonus.
- License: no explicit license or copyright page was found (`/copyright/` and `/disclaimer/` return 404; `https://euvsdisinfo.eu/about/` only calls the database an "open-source repository" and says MCP access is "by request only"). **Assumption**: as EEAS material, reuse with attribution is acceptable, and the organizer's provision of the token makes demo use legitimate. The catalog should record "EEAS / EUvsDisinfo, no explicit license, used with attribution and link; MCP access granted by organizer". Do not republish the archived disinformation content itself (third-party copyright). Store `claim` / `fact` and links only.
- Public alternatives: the academic dataset https://github.com/JAugusto97/euvsdisinfo (CC BY-SA 4.0, but distributes URLs and labels only, full text has to be rebuilt; base CSV on Zenodo https://zenodo.org/records/10514307); an old Kaggle snapshot (corrieaar/disinformation_articles, built from the EUvsDisinfo API in March 2020); Mendeley https://data.mendeley.com/datasets/yhdtkszvgp. The MCP is better: fresher, complete and structured. Use these only as a fallback if the token fails.

### 3. Polish fact-checkers directly

- Demagog (https://demagog.org.pl): IFCN + EFCSN member. RSS `https://demagog.org.pl/feed/sharefeed` (per its own site). `robots.txt` allows search crawling but declares `ai-train=no, use=reference` and disallows ClaudeBot, GPTBot, CCBot, Google-Extended, Diffbot and others. Our fetcher got HTTP 403 on `/feed/` and `/feed-rss/` (bot protection). Under the "do not bypass protections" rule: do not scrape with a spoofed user agent. Use Google FCT metadata, or the RSS feed only if it opens without circumvention, and cite as reference with a short excerpt.
- **Recheck 2026-11-21 (evening):** with the honest UA `PublicAlertCollector/0.1` the pages and `sitemap_index.xml` return 200 (no 403). robots.txt now carries a Cloudflare `Content-Signal: search=yes,ai-train=no,use=reference` for `*` and sets **no** `ai-input` signal (by its own text: neither granted nor restricted); training crawlers (ClaudeBot, GPTBot, CCBot, Google-Extended...) are disallowed. The reservation is made under art. 4 of Directive 2019/790. Reading for us: retrieval with a short quote and a link fits `use=reference`; training is out. Volume by sitemap `lastmod` (≈ modification date) for the last 3 years: `wypowiedzi` ~1,135, `fake_news` ~1,600-2,000 (963 since 2025-04 alone), `analizy_i_raporty` ~800-900; about 3,500-4,000 pages, ~230 KB HTML and ~5-8 KB text each.
- Konkret24 (https://konkret24.tvn24.pl, TVN): `robots.txt` blocks only GPTBot and `?page=` URLs, no sitemap listed. **Assumption**: TVN terms reserve all rights, so take metadata plus short excerpts (quotation right, art. 29 of the Polish copyright act), ideally via Google FCT.
- AFP Sprawdzam (https://sprawdzam.afp.com): no RSS found. AFP content is copyrighted, but its ClaimReview markup is reliable, so use Google FCT.
- FakeHunter (PAP, https://fakehunter.pap.pl): community verification with PAP staff, self-declared alignment with IFCN principles (not a confirmed signatory). Terms: https://fake-hunter.pap.pl/sites/default/files/2022-07/Terms_of_use.pdf. **Assumption**: no public feed; low priority.
- OKO.press "Prawda czy fałsz": **Assumption**: has a WordPress-style feed and possibly ClaimReview. Verify via Google FCT.
- Recommendation: one ingestion path, Google FCT with publisher filters. Direct site ingestion only for items Google lacks, and only where robots and terms permit.

### 4. Official sources (organizer list)

- gov.pl in general: `https://www.gov.pl/robots.txt` is `Allow: /` with no AI blocks and no crawl delay. Text is licensed **CC BY-SA 4.0** (https://www.gov.pl/web/gov/warunki-korzystania-z-portalu), which is ideal for an auditable catalog. No RSS found. Lists follow `.../{unit}/{section}?page=N&size=10` with a date per item, so one generic gov.pl list scraper serves every unit. Be polite: 1 request per second or slower.
- RCB: `https://www.gov.pl/web/rcb/komunikaty`, `https://www.gov.pl/web/rcb/alertrcb`, `https://www.gov.pl/web/rcb/aktualnosci`, daily report `https://www.gov.pl/web/rcb/raport-dobowy3`. Current items include Alert RCB messages dated 19-21.11.2026. Very high value: crisis rumors are the classic fact-check case.
- Ministry news lists are static HTML too (checked 2026-11-21): `https://www.gov.pl/web/aktywa-panstwowe/wiadomosci` lists the MAP release "Minister Wojciech Balczun z wizytą w Brukseli" (18.11.2026) with title and lead. The gov.pl site search (`/web/gov/szukaj?query=`) renders results with JS only (no results in static HTML), so a gov.pl route needs list pages per unit, not site search. A live check of that release found 0 records on every route, so gov.pl is the gap that turns official-statement claims into abstentions.
- `https://www.gov.pl/web/gov/ostrzezenia` is a JS search register (empty in static HTML). **Assumption**: it reads a JSON endpoint visible in browser devtools. Skip for the MVP and use the RCB and GIS lists.
- GIS: `https://www.gov.pl/web/gis/ostrzezenia` has about 90 items over 9 pages (food and product safety warnings).
- MSZ travel advice: the old URL redirects to `https://odyseusz.gov.pl/` (JS app). **Assumption**: country pages show a last-updated date. For the demo, capture 5-10 key countries (Ukraine, Belarus, Russia, Israel, Lebanon...) by hand with retrieval timestamps. Highest relevance for the MSZ jury.
- CERT Polska: RSS `https://moje.cert.pl/advisories/feed/`, filterable by category. 284 advisories, each with a date and reference (e.g. 218/2026 "Fałszywe informacje o zwrocie za energię elektryczną", 19-11-2026). Covers phishing and fake-message campaigns.
- Policja: RSS `https://policja.pl/pol/rss` (news).
- IMGW-PIB: `https://danepubliczne.imgw.pl/api/data/warningsmeteo`, `/warningshydro`, `/synop`, `/hydro`, `/meteo` (JSON; also XML/CSV). Terms (https://danepubliczne.imgw.pl/apiinfo): re-use allowed, free for non-commercial use, high-value datasets for any use. Mandatory attribution: "Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy", plus a "processed" notice when transformed. Useful for flood and storm rumors.
- GIOŚ: `https://api.gios.gov.pl/pjp-api/...`. Older `/rest/` services (station/findAll, aqindex/getIndex) are being withdrawn in favor of an OpenAPI-documented version (https://www.gov.pl/web/gios/korzystasz-z-danych-gios-o-jakosci-powietrza-za-posrednictwem-uslug-api-sprawdz-wazne-zmiany). Low fact-checking value.
- GDDKiA: traffic data and road news. Low value for disinformation, so skip.

### 5. Legal and data sources

- Sejm ELI API (https://api.sejm.gov.pl/eli_pl.html, OpenAPI at `http://api.sejm.gov.pl/eli/openapi/`): `/eli/acts/search?title=...&year=...`, `/eli/acts/{DU|MP}/{year}/{pos}` (fields: `title`, `announcementDate`, `promulgation`, `entryIntoForce`, `status`, `inForce`, `ELI`, `keywords`), text via `/text.html` or `/text.pdf`, plus `/changes/acts?since=` for updates. No terms page. Statutes are public domain under art. 4 of the Polish copyright act. Useful for "is there a law that..." claims (e.g. conscription, civil protection, foreigners).
- EUR-Lex: SPARQL on Cellar (`https://publications.europa.eu/webapi/rdf/sparql`) or direct HTML by CELEX (`https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:...`). Reuse allowed with attribution. Good for EU sanctions regulations (e.g. the regulations banning RT/Sputnik broadcasting) in Polish. For the MVP, fetch a handful of CELEX documents by hand.
- dane.gov.pl: REST JSON:API, verified live 2026-11-21: `/1.4/search?q=`, `/1.4/datasets?q=`, `/1.4/resources?q=&has_dynamic_data=true` (resources whose tabular data can be queried through the API). No key. Each dataset carries its license, `modified` and the publishing institution. **Corrected: P1, not P2.** It aggregates official datasets from ministries, GUS, GIS, municipalities and others, which makes it ideal for a **live lookup tool** answering statistical and administrative claims, not for bulk indexing.
- BIP: thousands of separate institution sites with no common API. Skip.

### 6. Other

- NASK: reports are PDFs on nask.pl, e.g. "Reakcja platform społecznościowych na zgłoszenia w 2025 roku" (https://www.nask.pl/media/2026/03/reakcja-platform-spolecznosciowych-na-zgloszenia-w-2025-roku.pdf) and the H1 2026 report (https://nask.pl/media/2026/06/Reakcja-platform-spolecznosciowych-na-zgloszenia.pdf). Also gov.pl/web/cyfryzacja news on NASK findings. A few docs add good context on narratives (health disinformation 2025 via CEDMO). **Assumption**: `dezinformacja.nask.pl` was not verified.
- EDMO: fact-checking repository (https://edmo.eu/edmo-news/edmo-launches-new-fact-checking-repository/) aggregating hub fact-checks; CEDMO briefs (https://cedmohub.eu/fact-checking/fact-checking-briefs) cover AFP and Demagog.pl. No API or license confirmed. P3.
- Check First (https://checkfirst.network/): research and datasets on the Pravda network (15M+ articles, 47 languages). No license shown. P3, but a good "known network" list for the source-status feature (**Assumption**: domain lists are in their reports).
- EU sanctions (source-status warning): the official FSF consolidated list (XML/CSV) needs an EU Login account and a per-user download link (do not commit that link). The data.europa.eu tracker (https://data.europa.eu/apps/eusanctionstracker/about/) describes the list (DG FISMA). The OpenSanctions mirror (https://www.opensanctions.org/datasets/eu_fsf) is easier but **CC BY-NC 4.0** and needs a license for commercial or in-house screening use. Since MSZ is the end user, prefer the official FSF file or EUR-Lex regulations. For the MVP, a small curated list of sanctioned media entities with the CELEX reference is enough for a neutral "this outlet is subject to EU restrictive measures (Regulation ...)" note.

## Recommended corpus plan (24h MVP)

Top sources by value per effort: (1) EUvsDisinfo MCP, (2) Google Fact Check API with PL publisher filters, (3) CERT Polska RSS, (4) gov.pl RCB + GIS + selected ministry lists (one generic scraper), (5) IMGW warnings API, (6) Sejm ELI API (curated acts), (7) policja.pl RSS, (8) EUR-Lex + MSZ travel advice captured by hand. NASK PDFs are optional.

| # | Source | Type | Target count | Domain(s) | Topic domains covered |
|---|---|---|---|---|---|
| 1 | EUvsDisinfo cases (filtered: countries contain Poland/Ukraine/EU, plus the latest 2 years) | Secondary: incident DB | 300-1000 indexed (all 19,873 optional for matching) | euvsdisinfo.eu | security, war in Ukraine, migration, health, elections, energy |
| 2 | Google FCT `languageCode=pl` + per-publisher filters | Secondary: fact-checkers | 150-300 ClaimReviews | demagog.org.pl, sprawdzam.afp.com, konkret24.tvn24.pl, oko.press (+ fakehunter.pap.pl if present) | politics, health, economy, war, climate |
| 3 | CERT Polska advisories RSS | Primary | 50 | cert.pl | cyber / scams |
| 4 | gov.pl RCB komunikaty + Alert RCB | Primary | 40 | gov.pl | crisis / civil protection |
| 5 | gov.pl GIS ostrzeżenia | Primary | 30 | gov.pl | food safety / health |
| 6 | gov.pl CIR / MSZ / MON / MZ komunikaty (10-20 each) | Primary | 40 | gov.pl | foreign affairs, defence, health |
| 7 | IMGW meteo + hydro warnings (snapshot) | Primary data | 20-50 records | imgw.pl | weather / floods |
| 8 | Sejm ELI curated acts (civil protection, defence of the homeland, foreigners, elections, cybersecurity) | Primary legal | 15 | sejm.gov.pl | law |
| 9 | policja.pl RSS | Primary | 20 | policja.pl | public safety |
| 10 | EUR-Lex sanctions regulations + MSZ travel advice (by hand) | Primary legal / official | 10 + 5-10 | eur-lex.europa.eu, odyseusz.gov.pl | sanctions, foreign affairs |
| 11 (opt.) | NASK reports | Primary analysis | 2-4 | nask.pl | disinformation landscape |

Result: about 700+ documents (≥100 even without EUvsDisinfo), 12+ web domains (euvsdisinfo.eu, demagog.org.pl, sprawdzam.afp.com, konkret24.tvn24.pl, oko.press, cert.pl, gov.pl, imgw.pl, sejm.gov.pl, policja.pl, eur-lex.europa.eu, odyseusz.gov.pl, nask.pl) and 10+ topic domains, with 2 source types (primary/official and secondary fact-checkers / incident DB). Whichever meaning of "domain" the jury uses, both are covered. Note: gov.pl counts as one web domain even though it hosts many publishers, so do not rely on gov.pl subpaths to reach 10.

### Common record schema (every document)

`id, source_id, source_type (primary|secondary|incident_db), publisher, title, url, language, published_at, retrieved_at, excerpt, body_or_summary, license, topic_tags[], verdict (fact-checks only), claimant (fact-checks only)`. `published_at` comes from RSS `pubDate`, ClaimReview `reviewDate`, EUvsDisinfo `date`, ELI `announcementDate`, or the gov.pl item date. `retrieved_at` is the time of our fetch (UTC ISO 8601). Store raw responses in `data/raw/{source}/{retrieved_at}.json` for auditability.

### Source catalog rules (bonus: open catalog)

- Qualify: the publisher is a public authority (PL/EU), or an IFCN/EFCSN-verified fact-checker, or the EEAS incident DB. Access is via API, RSS or robots-permitted HTML with no login, paywall or bot-protection bypass. License or terms are recorded. Every item has a publication date.
- Update: RSS and API sources daily (incremental by date or `since`); EUvsDisinfo weekly (offset paging from newest); ELI via `/changes/acts?since=`. Every run logs `retrieved_at` and the item count.
- Exclude: a source loses IFCN/EFCSN status or is on the EU sanctions list; robots or terms forbid our use (e.g. Demagog's AI-bot disallow means no direct scraping); paywalled content; items with no publication date; content we cannot attribute.

### Open checks (first hour)

1. One Google FCT call per Polish publisher filter to confirm which ones return ClaimReviews with `languageCode=pl`.
2. EUvsDisinfo token confirmed working on mcp.euvsd.info (2026-11-21). Still to measure: response time per 100 cases.
3. Check whether `https://demagog.org.pl/feed/sharefeed` is reachable with a plain, honest user agent. If not, rely on Google FCT only.
4. Check the IMGW warning field names and the Odyseusz page structure.


## Correction 2026-11-21: missed live official data APIs (checked by hand)
The first pass focused on the organizer's link list and undervalued **structured official data APIs**. These answer **numeric and procedural claims** (scenario A: an exact quote from a primary source) far better than scraped news pages. All were verified with live calls on 2026-11-21:
- **dane.gov.pl** `api.dane.gov.pl/1.4`: the national catalog. Search datasets and resources, and query tabular resources.
- **GUS BDL** `bdl.stat.gov.pl/api/v1`: population, unemployment, prices, demographics, by region and year.
- **NBP** `api.nbp.pl`: exchange rates, gold prices.
- **Eurostat** `ec.europa.eu/eurostat/api/dissemination/...`: EU comparisons ("Poland has the highest X in the EU").
- **Sejm API** `api.sejm.gov.pl/sejm/term10/`: MPs, **votings**, sittings, interpellations. Pair it with **Sejm ELI** `api.sejm.gov.pl/eli/` for legal acts (already listed above).

**Idea (how to use them):** two retrieval modes. (1) The **indexed corpus** (fact-checks, EUvsDisinfo, gov.pl news, CERT): bulk-ingested, hybrid search. (2) **Live tools** (dane.gov.pl, BDL, NBP, Eurostat, Sejm, ELI): called at check time when a claim is numeric, legal or parliamentary. Each response is stored as a source record with `retrieved_at` and the exact value quoted. Live tools also count toward the ≥10 domains and the "primary source" type.

## Trusted-source catalog (allowlist), 2026-11-21
Decision: [decisions/008](../decisions/008-trusted-source-allowlist.md). We never search the open web. A record becomes evidence only if its URL belongs to a publisher on the allowlist in `packages/core/src/sources/catalog.ts`; everything else (e.g. Snopes or unknown blogs returned by Google Fact Check) is dropped before the model sees it. The list is public at `GET /api/v1/sources` (the "open source catalog" bonus).

### Researched for the user's request (AP, Reuters, PAP, sprawdzamto.pl), checked live 2026-11-21
| Source | robots.txt / terms | Public API | How we use it | Tier |
|---|---|---|---|---|
| **AP** (apnews.com) | Disallows ClaudeBot, GPTBot, anthropic-ai, Claude-User and others; `/*.rss` disallowed; Cloudflare challenge (403) on hub pages | AP Media API on developer.ap.org: paid, application + sales review | **AP Fact Check ClaimReview via Google Fact Check** (already seen in our benchmark runs) | factcheck (AP Fact Check is an IFCN signatory) |
| **Reuters** (reuters.com) | Notice: "Collection … through automated means is prohibited unless you have prior written consent"; site returns 401 bot challenge | Reuters Connect API: paid, token auth, sales process | **Reuters Fact Check ClaimReview via Google Fact Check** | factcheck (Reuters Fact Check is an IFCN signatory) |
| **PAP** (pap.pl) | Blocks ClaudeBot, GPTBot, MistralAI-User and other AI agents everywhere except `/mediaroom`; Incapsula bot protection; no public RSS found (`/rss.xml` 404). fakehunter.pap.pl now redirects to pap.pl/fact-checking | PAP services (Serwis Informacyjny, Serwis Ekonomiczny) only under a client contract | Via Google Fact Check **if** PAP publishes ClaimReview (not verified: our probe of the index was blocked, see open questions); a PAP dispatch can be cited when a fact-checker links to it | media (national news agency, no fact-checker certification) |
| **Sprawdzam To** (sprawdzamto.pl) | robots.txt allows `/`, sitemap at `/sitemap.xml` (125 URLs, last updated 2026-06-11, so stale). **Regulamin §6 forbids automated collection (scraping) without the administrator's consent.** §7 allows quotation, reprint, summary with source "sprawdzamto.pl" and an active link | None; pages carry `NewsArticle` JSON-LD, **no ClaimReview**, so Google Fact Check likely does not index it | **Not connected** until the editors consent. Then: ingest into the corpus with attribution and link. Until then, editors may add single articles to the corpus by hand under §7 | media |

About **Sprawdzam To**: a joint fact-checking initiative of TVP, PAP and Polskie Radio, launched in May 2026 with the Ministry of Digital Affairs (administrator: TVP S.A. w likwidacji). No IFCN or EFCSN membership was found ([Demagog's note on the launch](https://demagog.org.pl/na-biezaco/sprawdzam-to-nowa-factcheckingowa-inicjatywa-panstwowych-mediow/), [gov.pl](https://www.gov.pl/web/cyfryzacja/media-publiczne-lacza-sily-w-walce-z-dezinformacja)). Its articles show a rating label ("FAŁSZ", "BRAK DOWODÓW", "CZĘŚCIOWY FAŁSZ"). It is PAP's fact-checking channel now, so it is also how PAP's checks would reach us.

### Tier rule
`official` (public authority, official statistics) and `factcheck` (IFCN/EFCSN-certified fact-checker or fact-check unit) count alone toward a verdict. `media` (trusted newsroom or non-certified fact-checking) needs a second independent origin. One publisher is one origin, however many articles it has.

### Statistics routes (now live)
GUS, NBP and Eurostat from the table above are connectors since 2026-11-21 (catalog of 16 indicators: `packages/core/src/connectors/stats-catalog.ts`; verified endpoints: [api-endpoints-verified.md](api-endpoints-verified.md#official-statistics-routes-verified-2026-11-21)). GUS BDL was unreachable all afternoon from our machine (curl and Deno: TLS handshake failure), so it is an optional route.
