from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .models import Record


class JsonStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def save(self, source: str, records: Iterable[Record]) -> tuple[Path, int]:
        records = list(records)
        path = self.data_dir / f"{source}.json"
        existing: list[dict] = []
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))

        by_id = {str(row["external_id"]): row for row in existing}
        changed = 0
        now = datetime.now(timezone.utc).isoformat()
        for record in records:
            row = record.as_dict()
            old = by_id.get(row["external_id"])
            row["first_seen_at"] = old.get("first_seen_at", now) if old is not None else now
            row["last_seen_at"] = now

            stable_row = {
                key: value
                for key, value in row.items()
                if key not in {"first_seen_at", "last_seen_at"}
            }
            old_stable_row = (
                {
                    key: value
                    for key, value in old.items()
                    if key not in {"first_seen_at", "last_seen_at"}
                }
                if old is not None
                else None
            )
            if old_stable_row != stable_row:
                changed += 1

            by_id[row["external_id"]] = row

        ordered = sorted(
            by_id.values(),
            key=lambda row: (
                row.get("updated_at") or row.get("published_at") or "",
                row["external_id"],
            ),
            reverse=True,
        )
        path.write_text(
            json.dumps(ordered, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return path, changed
