import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alert_collector.demagog import DemagogSource
from alert_collector.store import JsonStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Demagog fact-checks")
    parser.add_argument("--years", type=float, default=3, help="how far back (default 3)")
    parser.add_argument("--limit", type=int, default=None, help="stop after N pages (trial runs)")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    parser.add_argument("--output", default="data/demagog.json", help="output JSON file")
    args = parser.parse_args()

    source = DemagogSource(years=args.years, delay=args.delay, limit=args.limit)
    output = Path(args.output)
    store = JsonStore(output.parent)
    # Save in batches: a ~1 h run interrupted halfway keeps what it has, and
    # JsonStore merges by external_id, so a rerun only adds what is missing.
    batch: list = []
    changed = 0
    path = output
    for record in source.fetch():
        batch.append(record)
        if len(batch) >= 200:
            path, n = store.save(output.stem, batch)
            changed += n
            batch = []
            print(f"  saved {source.stats['fetched']}/{source.stats['listed']} pages", flush=True)
    path, n = store.save(output.stem, batch)
    changed += n
    print(f"Wrote {path} ({changed} changed)")
    print("Stats:", source.stats)
    if source.failed_urls:
        print("Failed URLs:", *source.failed_urls[:20], sep="\n  ")


if __name__ == "__main__":
    main()
