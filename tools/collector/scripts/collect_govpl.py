import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alert_collector.govpl import UNITS, GovPlNewsSource
from alert_collector.store import JsonStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect gov.pl news lists (KPRM, MSWiA, RCB, ...)")
    parser.add_argument("units", nargs="+", choices=sorted(UNITS), help="which units to collect")
    parser.add_argument("--months", type=float, default=6, help="how far back (default 6)")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    parser.add_argument("--data-dir", default="data", help="output directory")
    args = parser.parse_args()

    store = JsonStore(Path(args.data_dir))
    for name in args.units:
        source = GovPlNewsSource(UNITS[name], months=args.months, delay=args.delay)
        path, changed = store.save(name, source.fetch())
        print(f"Wrote {path} ({changed} changed)")
        print("Stats:", source.stats)
        if source.failed_urls:
            print("Failed URLs:", *source.failed_urls[:20], sep="\n  ")


if __name__ == "__main__":
    main()
