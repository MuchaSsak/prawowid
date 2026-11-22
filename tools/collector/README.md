# Polish public alert collector

A data-oriented collector for Polish government warnings, crisis reports, public
safety news, and fact-check claims.

The collector stores normalized JSON records and provenance (source URL, fetch
URL, first/last observation, raw payload hash). It prefers official APIs and RSS
feeds over HTML scraping and never treats an extractor without a validated
identifier as complete.

## Setup

```bash
python -m pip install -e ".[dev]"
```

## Run

```bash
# All currently enabled sources
python -m alert_collector

# Single source
python -m alert_collector rso

# Continuous refresh every 15 minutes
python -m alert_collector --interval 900
```

Set `GOOGLE_FACT_CHECK_API_KEY` to enable the official Google Fact Check Tools
claim search. Without a key, that source is intentionally not queried.

## Separate source scripts

Each completed source has a standalone runner that writes its own JSON file:

```bash
python scripts/collect_rso.py
python scripts/collect_rso_mazowieckie.py
python scripts/collect_rcb_report.py
python scripts/collect_odyseusz.py
python scripts/collect_kgpsp.py
python scripts/collect_policja.py
python scripts/collect_mazowiecka_policja.py
python scripts/collect_mon.py
python scripts/collect_gis.py
python scripts/collect_paa.py
python scripts/collect_paa_monitoring.py
python scripts/collect_mswia_rso.py
python scripts/collect_gios.py
python scripts/collect_cert_pl.py
python scripts/collect_infrastruktura.py
python scripts/collect_infrastruktura_info.py
python scripts/collect_gddkia.py
python scripts/collect_gddkia_info.py
python scripts/collect_gddkia_obstacles.py
python scripts/collect_gddkia_map.py
python scripts/collect_demagog.py   # --limit 20 for a trial run, --years 3 by default
python scripts/collect_govpl.py kprm mswia rcb   # any gov.pl news list in alert_collector/govpl.py UNITS, --months 6 by default
python scripts/collect_imgw_archive.py   # IMGW hydro warnings archive + PSHM bulletins, --months 6 by default
```

The outputs are respectively:

- `data/rso.json`
- `data/rso_mazowieckie.json`
- `data/rcb_report.json`
- `data/odyseusz.json`
- `data/kgpsp.json`
- `data/policja.json`
- `data/mazowiecka_policja.json`
- `data/mon.json`
- `data/gis.json`
- `data/paa.json`
- `data/paa_monitoring.json`
- `data/mswia_rso.json`
- `data/gios.json`
- `data/cert_pl.json`
- `data/infrastruktura.json`
- `data/infrastruktura_info.json`
- `data/gddkia.json`
- `data/gddkia_info.json`
- `data/gddkia_obstacles.json`
- `data/gddkia_map.json`
- `data/demagog.json` (fact-checker, secondary source: verdict, claim and
  claimant in `raw.claim_reviews`; cite as a reference with a link, per its
  robots.txt `Content-Signal: ai-train=no, use=reference`)
- `data/kprm.json`, `data/mswia.json`, `data/rcb.json` (and `data/<unit>.json` for other gov.pl units)
- `data/imgw_hydro_warnings.json` (every hydrological warning, change and
  cancellation from the IMGW archive; coastal ones have `raw.coast = true`)
  and `data/imgw_pshm_bulletin.json` (monthly PSHM bulletins, text only).
  Attribution required: "Źródłem pochodzenia danych jest IMGW-PIB". No
  meteorological data is collected (team decision).

## Transport sources

Collect the transport sources into separate JSON files.

```bash
python -m alert_collector ulc ulc_prawa_pasazera ulc_poradnik_pasazera \
  portal_pasazera utk kgsok sar umgdy ums_navigation wody_polskie_navigation
```

To refresh one transport source, run its script from the repository root.

```bash
python scripts/collect_utk.py
python scripts/collect_kgsok.py
python scripts/collect_umgdy.py
python scripts/collect_ums_navigation.py
python scripts/collect_wody_polskie_navigation.py
```

Each row includes the catalog URL, the original article or document URL, and
the publisher in `raw.publisher`. Publication and modification dates are
stored separately when the source supplies them. Transport snapshots store
excerpts of up to 1,200 characters and link to the originals.

- ULC reads the homepage news and the article tables in its two passenger
  sections. The passenger tables provide modification dates.
- Portal Pasażera reads the public guide. UTK reads the articles and section
  indexes linked from its passenger page.
- KGSOK and UMG Gdynia read the articles featured on their homepages. SAR
  reads the first page of its Polish news list.
- UMS Szczecin extracts text from the current warnings PDF. Other PDF entries
  carry the link and listing text, including any withdrawal marking.
- Wody Polskie follows the national index to the current notice list of each
  regional authority. It captures notice excerpts and links to attachments.
  The list describes what the authority published at the time of collection.
  Check the source for current validity before relying on a notice.

See [collection status](LINKS_STATUS.md) for live verification and access
issues. For existing snapshots, `last_seen_at` records the most recent time
the collector saw that row. The JSON store keeps earlier rows when a refresh
no longer lists them.
