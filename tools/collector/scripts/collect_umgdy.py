import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alert_collector.cli import build_source
from alert_collector.store import JsonStore


def main() -> None:
    source = build_source("umgdy")
    store = JsonStore(Path("data"))
    path, changed = store.save(source.name, source.fetch())
    print(f"Wrote {path} ({changed} changed)")


if __name__ == "__main__":
    main()
