import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alert_collector.imgw_archive import ImgwHydroWarningsArchiveSource, ImgwPshmBulletinSource
from alert_collector.store import JsonStore


def main() -> None:
    parser = argparse.ArgumentParser(description="IMGW historical hydro warnings and PSHM bulletins")
    parser.add_argument("--months", type=float, default=6, help="how far back (default 6)")
    parser.add_argument("--data-dir", default="data")
    args = parser.parse_args()

    store = JsonStore(Path(args.data_dir))
    for source in (ImgwHydroWarningsArchiveSource(months=args.months), ImgwPshmBulletinSource(months=args.months)):
        path, changed = store.save(source.name, source.fetch())
        print(f"Wrote {path} ({changed} changed)")
        print("Stats:", source.stats)


if __name__ == "__main__":
    main()
