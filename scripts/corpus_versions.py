"""Versioned, registry-aware corpus: schema upgrade, replace-batch, listing, history and revision.

HTTP contract: see VECTOR_DB_README.md. One /documents batch is one transaction; `corpus_revision` is bumped
once per batch that changed anything.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager, nullcontext
from datetime import date, datetime, timezone
from pathlib import Path

from scripts.ingest_corpus import build_chunks


ROOT = Path(__file__).resolve().parents[1]
INIT_SQL = ROOT / "infra" / "postgres" / "init.sql"
MIGRATION_SQL = ROOT / "infra" / "postgres" / "migrations" / "002-versioned-corpus.sql"

KINDS = ("dated_statement", "standing_state")
WRITE_LOCK_KEY = 4207203
MAX_BATCH = 500
MAX_LIST_LIMIT = 500

# Fields that, together with content_hash, decide `unchanged` vs `changed`.
IDENTITY_FIELDS = ("publisher_id", "binding_id", "kind", "title", "canonical_url", "published_at", "effective_from", "effective_to")

VERSION_COLUMNS = """d.document_id, d.document_version, d.publisher_id, d.binding_id, d.kind, d.status, d.title,
       d.canonical_url, d.published_at, d.retrieved_at, d.effective_from, d.effective_to, d.superseded_at,
       d.content_hash, length(d.normalized_text) AS chars, d.test_data"""

# Validity windows per version (shared rule, see contract):
#   valid_from = coalesce(effective_from, published_at::date, retrieved_at::date)
#   valid_to   = coalesce(effective_to, valid_from(next version) - 1 day), NULL = open
# Timestamps are converted to dates in UTC.
WINDOWS_CTE = """
    versions AS (
        SELECT d.*,
               COALESCE(d.effective_from, (d.published_at AT TIME ZONE 'UTC')::date,
                        (d.retrieved_at AT TIME ZONE 'UTC')::date) AS valid_from
        FROM documents d
    ),
    windows AS (
        SELECT v.*,
               COALESCE(v.effective_to,
                        LEAD(v.valid_from) OVER (PARTITION BY v.document_id ORDER BY v.document_version) - 1) AS valid_to
        FROM versions v
    )"""


class BatchValidationError(ValueError):
    def __init__(self, errors: list[dict]):
        super().__init__("validation_failed")
        self.errors = errors


class DocumentNotFound(LookupError):
    pass


# ── helpers ─────────────────────────────────────────────────────────────


def _row(row) -> dict:
    return row if isinstance(row, dict) else dict(row)


def _scalar(row):
    if row is None:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


@contextmanager
def _transaction(connection):
    transaction = getattr(connection, "transaction", None)
    with (transaction() if callable(transaction) else nullcontext()):
        yield


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def iso(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def serialize_version(row, include_text: bool = False) -> dict:
    row = _row(row)
    result = {
        "document_id": row["document_id"],
        "version": row["document_version"],
        "publisher_id": row.get("publisher_id"),
        "binding_id": row.get("binding_id"),
        "kind": row.get("kind") or "dated_statement",
        "status": row.get("status") or "current",
        "title": row.get("title"),
        "canonical_url": row.get("canonical_url"),
        "published_at": iso(row.get("published_at")),
        "retrieved_at": iso(row.get("retrieved_at")),
        "effective_from": iso(row.get("effective_from")),
        "effective_to": iso(row.get("effective_to")),
        "superseded_at": iso(row.get("superseded_at")),
        "content_hash": row.get("content_hash"),
        "chars": row.get("chars"),
        "test_data": bool(row.get("test_data")),
    }
    if include_text:
        result["text"] = row.get("normalized_text")
    return result


def parse_date(value) -> date | None:
    if value is None or isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        raise ValueError("not_a_date")
    return date.fromisoformat(value)


def parse_timestamp(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise ValueError("not_a_timestamp")
    if parsed is not None and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


# ── schema ──────────────────────────────────────────────────────────────


def ensure_schema(connection) -> None:
    """Create (if missing) and upgrade the schema to the versioned corpus. Idempotent; one transaction."""
    with _transaction(connection):
        if _scalar(connection.execute("SELECT to_regclass('public.documents') IS NOT NULL").fetchone()) is not True:
            connection.execute(INIT_SQL.read_text(encoding="utf-8"))
        connection.execute(MIGRATION_SQL.read_text(encoding="utf-8"))


def schema_kind(connection) -> str:
    row = connection.execute(
        "SELECT count(*) FROM information_schema.columns WHERE table_name = 'documents' AND column_name IN ('status', 'publisher_id')"
    ).fetchone()
    return "versioned" if _scalar(row) == 2 else "legacy"


def read_revision(connection) -> int:
    row = connection.execute("SELECT value FROM corpus_meta WHERE key = 'corpus_revision'").fetchone()
    value = _scalar(row)
    return int(value) if value is not None else 0


def bump_revision(connection) -> int:
    row = connection.execute("""
        INSERT INTO corpus_meta (key, value) VALUES ('corpus_revision', 1)
        ON CONFLICT (key) DO UPDATE SET value = corpus_meta.value + 1
        RETURNING value
    """).fetchone()
    return int(_scalar(row))


# ── validation ──────────────────────────────────────────────────────────


def validate_documents(payload) -> tuple[list[dict], list[dict]]:
    """Return (prepared documents, errors). Any error rejects the whole batch."""
    if not isinstance(payload, dict) or not isinstance(payload.get("documents"), list):
        return [], [{"code": "invalid_body", "message": "Body must be {\"documents\": [...]}."}]
    documents = payload["documents"]
    if len(documents) > MAX_BATCH:
        return [], [{"code": "batch_too_large", "message": f"At most {MAX_BATCH} documents per batch."}]

    prepared: list[dict] = []
    errors: list[dict] = []
    seen: set[str] = set()

    def fail(index: int, code: str, field: str, message: str):
        errors.append({"code": code, "message": f"documents[{index}].{field}: {message}"})

    for index, document in enumerate(documents):
        if not isinstance(document, dict):
            errors.append({"code": "invalid_document", "message": f"documents[{index}]: must be an object"})
            continue
        before = len(errors)
        for field in ("document_id", "publisher_id", "binding_id", "canonical_url", "text"):
            value = document.get(field)
            if not isinstance(value, str) or not value.strip():
                fail(index, "missing_field", field, "required non-empty string")
        for field in ("title", "language", "license_status"):
            value = document.get(field)
            if value is not None and not isinstance(value, str):
                fail(index, "invalid_field", field, "must be a string or null")
        kind = document.get("kind") or "dated_statement"
        if kind not in KINDS:
            fail(index, "invalid_kind", "kind", f"must be one of {', '.join(KINDS)}")
        test_data = document.get("test_data", False)
        if not isinstance(test_data, bool):
            fail(index, "invalid_field", "test_data", "must be a boolean")

        parsed: dict = {}
        for field in ("published_at", "retrieved_at"):
            try:
                parsed[field] = parse_timestamp(document.get(field))
            except ValueError:
                fail(index, "invalid_timestamp", field, "must be an ISO 8601 timestamp or null")
        for field in ("effective_from", "effective_to"):
            try:
                parsed[field] = parse_date(document.get(field))
            except ValueError:
                fail(index, "invalid_date", field, "must be YYYY-MM-DD or null")
        if parsed.get("effective_from") and parsed.get("effective_to") and parsed["effective_from"] > parsed["effective_to"]:
            fail(index, "invalid_effective_window", "effective_to", "must not be before effective_from")

        document_id = document.get("document_id")
        if isinstance(document_id, str):
            if document_id in seen:
                fail(index, "duplicate_document_id", "document_id", "appears more than once in this batch")
            seen.add(document_id)

        if len(errors) > before:
            continue
        text = document["text"]
        prepared.append({
            "document_id": document_id,
            "publisher_id": document["publisher_id"],
            "binding_id": document["binding_id"],
            "source_id": document["binding_id"],
            "kind": kind,
            "title": document.get("title"),
            "canonical_url": document["canonical_url"],
            "published_at": parsed["published_at"],
            "retrieved_at": parsed["retrieved_at"] or datetime.now(timezone.utc),
            "effective_from": parsed["effective_from"],
            "effective_to": parsed["effective_to"],
            "normalized_text": text,
            "content_hash": content_hash(text),
            "language": document.get("language") or "pl",
            "license_status": document.get("license_status") or "unknown",
            "content_status": "usable",
            "published_at_source": "registry",
            "test_data": test_data,
        })
    return prepared, errors


# ── replace batch ───────────────────────────────────────────────────────


def _same_identity(current: dict, document: dict) -> bool:
    if current["content_hash"] != document["content_hash"]:
        return False
    for field in IDENTITY_FIELDS:
        left, right = current.get(field), document.get(field)
        if field == "published_at":
            left, right = parse_timestamp(left), parse_timestamp(right)
        elif field in ("effective_from", "effective_to"):
            left, right = parse_date(left), parse_date(right)
        if left != right:
            return False
    return True


def _insert_version(connection, document: dict, embedder, max_chars: int) -> None:
    connection.execute("""
        INSERT INTO documents (document_id, document_version, source_id, canonical_url, title, language,
            published_at, retrieved_at, content_hash, content_status, license_status, normalized_text,
            published_at_source, publisher_id, binding_id, kind, status, effective_from, effective_to, test_data)
        VALUES (%(document_id)s, %(document_version)s, %(source_id)s, %(canonical_url)s, %(title)s, %(language)s,
            %(published_at)s, %(retrieved_at)s, %(content_hash)s, %(content_status)s, %(license_status)s,
            %(normalized_text)s, %(published_at_source)s, %(publisher_id)s, %(binding_id)s, %(kind)s, 'current',
            %(effective_from)s, %(effective_to)s, %(test_data)s)
    """, document)
    for chunk in build_chunks(document, embedder, max_chars=max_chars):
        connection.execute("""
            INSERT INTO chunks (chunk_id, document_id, document_version, chunk_index, text, start_offset,
                end_offset, embedding_model_id, embedding, text_hash)
            VALUES (%(chunk_id)s, %(document_id)s, %(document_version)s, %(chunk_index)s, %(text)s,
                %(start_offset)s, %(end_offset)s, %(embedding_model_id)s, %(embedding)s::vector, %(text_hash)s)
        """, {**chunk, "embedding": "[" + ",".join(str(float(value)) for value in chunk["embedding"]) + "]"})


def replace_documents(payload, connection, embedder, max_chars: int = 700) -> dict:
    """Apply one /documents batch in a single transaction. Raises BatchValidationError before any write."""
    documents, errors = validate_documents(payload)
    if errors:
        raise BatchValidationError(errors)

    results = []
    with _transaction(connection):
        # One writer at a time: version numbers and the one-current rule stay consistent across batches.
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK_KEY,))
        ids = [document["document_id"] for document in documents]
        current = {}
        max_version = {}
        if ids:
            for row in connection.execute("""
                SELECT document_id, document_version, publisher_id, binding_id, kind, title, canonical_url,
                       published_at, effective_from, effective_to, content_hash
                FROM documents
                WHERE document_id = ANY(%s) AND status = 'current'
                FOR UPDATE
            """, (ids,)).fetchall():
                row = _row(row)
                current[row["document_id"]] = row
            for row in connection.execute("""
                SELECT document_id, max(document_version) AS max_version
                FROM documents WHERE document_id = ANY(%s) GROUP BY document_id
            """, (ids,)).fetchall():
                row = _row(row)
                max_version[row["document_id"]] = row["max_version"]

        changed_any = False
        for document in documents:
            document_id = document["document_id"]
            existing = current.get(document_id)
            if existing is not None and existing.get("publisher_id") is None and existing["content_hash"] == document["content_hash"]:
                connection.execute("""
                    UPDATE documents
                    SET publisher_id = %(publisher_id)s, binding_id = %(binding_id)s, kind = %(kind)s,
                        title = %(title)s, canonical_url = %(canonical_url)s, published_at = %(published_at)s,
                        effective_from = %(effective_from)s, effective_to = %(effective_to)s,
                        test_data = %(test_data)s, language = %(language)s, license_status = %(license_status)s
                    WHERE document_id = %(document_id)s AND document_version = %(document_version)s
                """, {**document, "document_version": existing["document_version"]})
                results.append({"document_id": document_id, "version": existing["document_version"], "status": "adopted"})
                changed_any = True
                continue
            if existing is not None and _same_identity(existing, document):
                results.append({"document_id": document_id, "version": existing["document_version"], "status": "unchanged"})
                continue
            if existing is not None:
                connection.execute("""
                    UPDATE documents SET status = 'superseded', superseded_at = now()
                    WHERE document_id = %s AND status = 'current'
                """, (document_id,))
            version = (max_version.get(document_id) or 0) + 1
            _insert_version(connection, {**document, "document_version": version}, embedder, max_chars)
            results.append({"document_id": document_id, "version": version, "status": "changed" if existing is not None else "new"})
            changed_any = True

        revision = bump_revision(connection) if changed_any else read_revision(connection)
    return {"results": results, "corpus_revision": revision}


# ── reads ───────────────────────────────────────────────────────────────


def list_documents(connection, publisher_id=None, binding_id=None, q=None, on_date=None,
                   include_superseded: bool = False, limit: int = 100) -> list[dict]:
    """Document versions without text, newest published_at first.

    Without `on_date`: current versions only, unless include_superseded. With `on_date`: every version whose
    validity window contains that date (current or superseded), which is what a dated view needs.
    """
    if not 1 <= limit <= MAX_LIST_LIMIT:
        raise ValueError("limit_out_of_range")
    conditions = []
    params: dict = {"limit": limit}
    if publisher_id:
        conditions.append("d.publisher_id = %(publisher_id)s")
        params["publisher_id"] = publisher_id
    if binding_id:
        conditions.append("d.binding_id = %(binding_id)s")
        params["binding_id"] = binding_id
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("(d.title ILIKE %(q)s OR d.normalized_text ILIKE %(q)s)")
        params["q"] = f"%{escaped}%"
    if on_date is not None:
        conditions.append("d.valid_from <= %(on_date)s AND (d.valid_to IS NULL OR d.valid_to >= %(on_date)s)")
        params["on_date"] = parse_date(on_date)
    elif not include_superseded:
        conditions.append("d.status = 'current'")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = connection.execute(f"""
        WITH {WINDOWS_CTE}
        SELECT {VERSION_COLUMNS}
        FROM windows d
        {where}
        ORDER BY d.published_at DESC NULLS LAST, d.document_id, d.document_version DESC
        LIMIT %(limit)s
    """, params).fetchall()
    return [serialize_version(row) for row in rows]


def document_history(connection, document_id: str) -> dict:
    rows = connection.execute(f"""
        SELECT {VERSION_COLUMNS}, d.normalized_text
        FROM documents d
        WHERE d.document_id = %s
        ORDER BY d.document_version DESC
    """, (document_id,)).fetchall()
    if not rows:
        raise DocumentNotFound(document_id)
    return {"document_id": document_id, "versions": [serialize_version(row, include_text=True) for row in rows]}


# ── reference implementation of the version rule (mirrors the SQL; used by tests) ──


def _utc_date(value) -> date | None:
    value = parse_timestamp(value) if isinstance(value, (str, datetime)) else value
    return value.astimezone(timezone.utc).date() if isinstance(value, datetime) else value


def version_windows(versions: list[dict]) -> list[dict]:
    """Attach valid_from/valid_to to every version of ONE document (ordered by version)."""
    ordered = sorted(versions, key=lambda item: item["document_version"])
    starts = [parse_date(item.get("effective_from")) or _utc_date(item.get("published_at")) or _utc_date(item.get("retrieved_at"))
              for item in ordered]
    result = []
    for index, item in enumerate(ordered):
        next_start = starts[index + 1] if index + 1 < len(ordered) else None
        valid_to = parse_date(item.get("effective_to"))
        if valid_to is None and next_start is not None:
            valid_to = date.fromordinal(next_start.toordinal() - 1)
        result.append({**item, "valid_from": starts[index], "valid_to": valid_to})
    return result


def select_version(versions: list[dict], mode: str, today: date, claim_period: tuple[date, date] | None = None) -> dict | None:
    """The version of ONE document that search may use, or None."""
    windows = version_windows(versions)
    current = next((item for item in windows if item.get("status", "current") == "current"), None)
    kind = (current or windows[-1]).get("kind", "dated_statement")
    if kind == "dated_statement":
        return current
    if mode == "today":
        if current is None or current["valid_from"] is None or current["valid_from"] > today:
            return None
        effective_to = parse_date(current.get("effective_to"))
        return current if effective_to is None or effective_to >= today else None
    start, end = claim_period
    overlapping = [item for item in windows
                   if item["valid_from"] is not None and item["valid_from"] <= end
                   and (item["valid_to"] is None or item["valid_to"] >= start)]
    return max(overlapping, key=lambda item: item["document_version"]) if overlapping else None
