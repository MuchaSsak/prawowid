"""Exact pgvector retrieval with literal, source-backed quotes."""

from __future__ import annotations

import math
import os
from datetime import date, datetime, timezone
from urllib.parse import urlparse


DEFAULT_THRESHOLD = float(os.environ.get("PRAWDOWID_RETRIEVAL_THRESHOLD", "0.82"))
MAX_K = 20
MODES = ("today", "historical")

RESULT_COLUMNS = """c.chunk_id, c.document_id, c.document_version, c.chunk_index,
               c.text, c.start_offset, c.end_offset, c.embedding_model_id,
               d.title, d.source_id, d.canonical_url, d.published_at,
               d.retrieved_at, d.normalized_text, d.publisher_id, d.binding_id,
               d.kind, d.status, d.effective_from, d.effective_to"""


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def _cosine(left: list[float], right: list[float]) -> float:
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0.0


def _publisher(url: str) -> str:
    return urlparse(url).hostname or "unknown"


def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return (value if value.tzinfo is None else value.astimezone(timezone.utc)).date()
    if isinstance(value, date):
        return value
    text = str(value)
    if len(text) == 10:
        return date.fromisoformat(text)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return (parsed if parsed.tzinfo is None else parsed.astimezone(timezone.utc)).date()


def _iso_date(value):
    return value.isoformat() if isinstance(value, date) else value


def _registry_query(publisher_ids, binding_ids, filters: dict, mode: str, today: date, claim_period) -> tuple[str, dict]:
    """Registry mode: publisher/binding filter and the version rule live in WHERE, before the vector ranking."""
    from scripts.corpus_versions import WINDOWS_CTE

    params: dict = {"mode": mode}
    conditions = []
    if publisher_ids is not None:
        conditions.append("w.publisher_id = ANY(%(publisher_ids)s)")
        params["publisher_ids"] = list(publisher_ids)
    if binding_ids is not None:
        conditions.append("w.binding_id = ANY(%(binding_ids)s)")
        params["binding_ids"] = list(binding_ids)
    if filters.get("source_id"):
        conditions.append("w.source_id = %(source_id)s")
        params["source_id"] = filters["source_id"]

    # dated_statement: always the current version. standing_state: depends on mode.
    if mode == "today":
        standing = ("w.status = 'current' AND w.valid_from <= %(today)s "
                    "AND (w.effective_to IS NULL OR w.effective_to >= %(today)s)")
        params["today"] = today
    else:
        standing = "w.overlap_rank = 1"
        params["period_start"], params["period_end"] = claim_period
    conditions.append(f"((w.kind = 'dated_statement' AND w.status = 'current') OR (w.kind = 'standing_state' AND {standing}))")

    # Highest version (per document) whose window overlaps the claim period; NULL when it does not overlap.
    ranked = """,
    ranked AS (
        SELECT win.*,
               CASE WHEN win.valid_from <= %(period_end)s AND (win.valid_to IS NULL OR win.valid_to >= %(period_start)s)
                    THEN ROW_NUMBER() OVER (
                        PARTITION BY win.document_id,
                                     (win.valid_from <= %(period_end)s AND (win.valid_to IS NULL OR win.valid_to >= %(period_start)s))
                        ORDER BY win.document_version DESC)
               END AS overlap_rank
        FROM windows win
    )""" if mode == "historical" else """,
    ranked AS (SELECT win.*, NULL::bigint AS overlap_rank FROM windows win)"""

    sql = f"""
        WITH {WINDOWS_CTE}{ranked},
        eligible AS (
            SELECT w.* FROM ranked w
            WHERE {" AND ".join(conditions)}
        )
        SELECT {RESULT_COLUMNS.replace("d.", "e.")},
               1 - (c.embedding <=> %(query_vector)s::vector) AS score
        FROM chunks c
        JOIN eligible e USING (document_id, document_version)
        ORDER BY c.embedding <=> %(query_vector)s::vector
        LIMIT 100
    """
    return sql, params


def _stale(row: dict, mode: str, today: date, freshness: dict[str, int]) -> bool:
    if mode != "today" or row.get("kind") != "standing_state":
        return False
    days = freshness.get(row.get("binding_id"))
    if days is None:
        return False
    updated = _as_date(row.get("published_at")) or _as_date(row.get("retrieved_at"))
    return updated is not None and (today - updated).days > days


def search(query: str, k: int, filters: dict, connection, embedder, threshold: float = DEFAULT_THRESHOLD,
           publisher_ids=None, binding_ids=None, mode: str = "today", today=None, claim_period=None,
           freshness=None) -> dict:
    """Vector search over chunks.

    Legacy mode (publisher_ids and binding_ids both None): every `current` version, optional source_id filter.
    Registry mode (either list given): only versions of the given publishers/bindings that pass the version
    rule (see corpus_versions). An empty list means no results, never "no filter".
    """
    if not query or not query.strip():
        raise ValueError("query_empty")
    if not 1 <= k <= MAX_K:
        raise ValueError("k_out_of_range")
    filters = filters or {}
    registry_mode = publisher_ids is not None or binding_ids is not None
    mode = mode or "today"
    if mode not in MODES:
        raise ValueError("mode_invalid")
    today = _as_date(today) or date.today()
    period = None
    if mode == "historical":
        if not claim_period or not claim_period.get("start") or not claim_period.get("end"):
            raise ValueError("claim_period_required")
        period = (_as_date(claim_period["start"]), _as_date(claim_period["end"]))
        if period[0] > period[1]:
            raise ValueError("claim_period_invalid")
    freshness_days = {}
    for rule in freshness or []:
        if not rule.get("binding_id") or not isinstance(rule.get("days"), int) or rule["days"] < 0:
            raise ValueError("freshness_invalid")
        freshness_days[rule["binding_id"]] = rule["days"]

    index_snapshot = {"embedding_model_id": getattr(embedder, "model_id", None), "threshold": threshold}
    if registry_mode and (publisher_ids is not None and not publisher_ids or binding_ids is not None and not binding_ids):
        return {"query": query, "filters": filters, "index_snapshot": index_snapshot, "results": [],
                "limitations": ["brak pasujących fragmentów w korpusie"], "errors": []}

    query_vector = embedder.embed_query(f"query: {query.strip()}")
    if len(query_vector) != embedder.dimension:
        raise ValueError("embedding_dimension_mismatch")

    if registry_mode:
        sql, params = _registry_query(publisher_ids, binding_ids, filters, mode, today, period)
        params["query_vector"] = _vector_literal(query_vector)
    else:
        params = [_vector_literal(query_vector)]
        conditions = ["d.status = 'current'"]
        if filters.get("source_id"):
            conditions.append("d.source_id = %s")
            params.append(filters["source_id"])
        sql = f"""
            SELECT {RESULT_COLUMNS},
                   1 - (c.embedding <=> %s::vector) AS score
            FROM chunks c
            JOIN documents d USING (document_id, document_version)
            WHERE {" AND ".join(conditions)}
            ORDER BY c.embedding <=> %s::vector
            LIMIT 100
        """
        params.append(_vector_literal(query_vector))
    rows = connection.execute(sql, params).fetchall()

    results = []
    for row in rows:
        row = dict(row) if not isinstance(row, dict) else row
        start = row["start_offset"]
        end = row["end_offset"]
        quoted_text = row["normalized_text"][start:end]
        if quoted_text != row["text"]:
            return {"query": query, "filters": filters, "index_snapshot": row["embedding_model_id"], "results": [], "limitations": ["quote_validation_failed"], "errors": [{"code": "quote_validation_failed", "message": "Stored chunk is not a literal slice of normalized_text."}]}
        score = float(row["score"])
        if score < threshold:
            continue
        results.append({
            "chunk_id": row["chunk_id"],
            "document_id": row["document_id"],
            "document_version": row["document_version"],
            "score": score,
            "title": row["title"],
            "publisher": _publisher(row["canonical_url"]),
            "published_at": row["published_at"],
            "retrieved_at": row["retrieved_at"],
            "url": row["canonical_url"],
            "quoted_text": quoted_text,
            "start_offset": start,
            "end_offset": end,
            "publisher_id": row.get("publisher_id"),
            "binding_id": row.get("binding_id"),
            "kind": row.get("kind") or "dated_statement",
            "status": row.get("status") or "current",
            "effective_from": _iso_date(row.get("effective_from")),
            "effective_to": _iso_date(row.get("effective_to")),
            "stale": _stale(row, mode, today, freshness_days),
        })
    results.sort(key=lambda item: (-item["score"], item["chunk_id"]))
    return {
        "query": query,
        "filters": filters,
        "index_snapshot": index_snapshot,
        "results": results[:k],
        "limitations": [] if results else ["brak pasujących fragmentów w korpusie"],
        "errors": [],
    }
