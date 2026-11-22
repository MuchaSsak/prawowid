from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
from typing import Any


@dataclass
class Record:
    source: str
    source_url: str
    external_id: str
    title: str
    detail_url: str | None = None
    published_at: str | None = None
    updated_at: str | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    content: str | None = None
    summary: str | None = None
    language: str = "pl"
    category: str | None = None
    location: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def raw_hash(self) -> str:
        import json

        payload = json.dumps(self.raw, ensure_ascii=False, sort_keys=True)
        return sha256(payload.encode("utf-8")).hexdigest()

    def as_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["raw_sha256"] = self.raw_hash()
        return value
