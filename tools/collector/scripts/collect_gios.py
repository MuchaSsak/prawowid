import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alert_collector.sources import GiosSource
from alert_collector.store import JsonStore


def main() -> None:
    store = JsonStore(Path("data"))
    path, changed = store.save("gios", GiosSource().fetch())
    print(f"Wrote {path} ({changed} changed)")


if __name__ == "__main__":
    main()
