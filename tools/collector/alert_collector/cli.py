from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

from .catalog import SOURCES
from .demagog import DemagogSource
from .govpl import UNITS as GOVPL_UNITS, GovPlNewsSource
from .sources import (
    GoogleFactCheckSource,
    GovHtmlSource,
    KgPspNewsSource,
    GisWarningsSource,
    GiosSource,
    CertPlNewsSource,
    InfrastrukturaNewsSource,
    InfrastrukturaInfoSource,
    GddkiaNewsSource,
    GddkiaInfoSource,
    GddkiaObstaclesSource,
    GddkiaMapSource,
    MazowieckaPolicjaNewsSource,
    MonNewsSource,
    OdyseuszSource,
    MswiaRsoSource,
    PaaNewsSource,
    PaaMonitoringSource,
    PolicjaNewsSource,
    RcbReportSource,
    RsoSource,
    SourceError,
)
from .store import JsonStore
from .transport import TRANSPORT_SOURCES


def build_source(spec_name: str):
    spec = next((spec for spec in SOURCES if spec.name == spec_name), None)
    if spec is None:
        raise SourceError(f"Unknown source: {spec_name}")
    if spec.type == "rso":
        return RsoSource()
    if spec.type == "rso_mazowieckie":
        return RsoSource(
            voivodeship="mazowieckie",
            category="wszystkie",
            name="rso_mazowieckie",
        )
    if spec.type == "rcb_report":
        return RcbReportSource()
    if spec.type == "google_fact_check":
        return GoogleFactCheckSource()
    if spec.type == "odyseusz":
        return OdyseuszSource()
    if spec.type == "kgpsp":
        return KgPspNewsSource()
    if spec.type == "policja":
        return PolicjaNewsSource()
    if spec.type == "mazowiecka_policja":
        return MazowieckaPolicjaNewsSource()
    if spec.type == "mon":
        return MonNewsSource()
    if spec.type == "gis":
        return GisWarningsSource()
    if spec.type == "paa":
        return PaaNewsSource()
    if spec.type == "paa_monitoring":
        return PaaMonitoringSource()
    if spec.type == "mswia_rso":
        return MswiaRsoSource()
    if spec.type == "gios":
        return GiosSource()
    if spec.type == "cert_pl":
        return CertPlNewsSource()
    if spec.type == "infrastruktura":
        return InfrastrukturaNewsSource()
    if spec.type == "infrastruktura_info":
        return InfrastrukturaInfoSource()
    if spec.type == "gddkia":
        return GddkiaNewsSource()
    if spec.type == "gddkia_info":
        return GddkiaInfoSource()
    if spec.type == "gddkia_obstacles":
        return GddkiaObstaclesSource()
    if spec.type == "gddkia_map":
        return GddkiaMapSource()
    if spec.type in TRANSPORT_SOURCES:
        return TRANSPORT_SOURCES[spec.type](spec)
    if spec.type == "demagog":
        return DemagogSource()
    if spec.type == "govpl":
        return GovPlNewsSource(GOVPL_UNITS[spec.name])
    if spec.type == "gov_html":
        return GovHtmlSource(spec.url, spec.name)
    raise SourceError(
        f"Source {spec.name} needs a dedicated implementation ({spec.type})"
    )


def run_once(output: Path, selected: list[str] | None) -> int:
    store = JsonStore(output)
    total_changed = 0

    selected_set = set(selected or [])
    for spec in SOURCES:
        if selected_set:
            if spec.name not in selected_set:
                continue
        elif not spec.enabled:
            continue

        print(f"[{spec.name}] fetching", flush=True)
        try:
            source = build_source(spec.name)
            path, changed = store.save(spec.name, source.fetch())
            total_changed += changed
            print(f"[{spec.name}] wrote {path} ({changed} changed)", flush=True)
        except SourceError as exc:
            print(f"[{spec.name}] not available: {exc}", flush=True)
        except Exception as exc:
            print(f"[{spec.name}] error: {exc}", flush=True)

    return total_changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "sources",
        nargs="*",
        help="Source names to run; with no names, run enabled sources",
    )
    parser.add_argument("--output", type=Path, default=Path("data"))
    parser.add_argument(
        "--interval",
        type=int,
        default=0,
        help="Repeat every N seconds; 0 means one run",
    )
    args = parser.parse_args()

    if args.interval < 0:
        parser.error("--interval must be non-negative")

    while True:
        run_once(args.output, args.sources)
        if not args.interval:
            break
        print(f"Sleeping {args.interval} seconds", flush=True)
        time.sleep(args.interval)
