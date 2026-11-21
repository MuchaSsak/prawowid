"""Exact pgvector retrieval with literal, source-backed quotes."""

from __future__ import annotations

import math
import os
from urllib.parse import urlparse


DEFAULT_THRESHOLD = float(os.environ.get("PRAWDOWID_RETRIEVAL_THRESHOLD", "0.82"))


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def _cosine(left: list[float], right: list[float]) -> float:
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0.0


def _publisher(url: str) -> str:
    return urlparse(url).hostname or "unknown"


def search(query: str, k: int, filters: dict, connection, embedder, threshold: float = DEFAULT_THRESHOLD) -> dict:
    if not query or not query.strip():
        raise ValueError("query_empty")
    if not 1 <= k <= 10:
        raise ValueError("k_out_of_range")

    query_vector = embedder.embed_query(f"query: {query.strip()}")
    if len(query_vector) != embedder.dimension:
        raise ValueError("embedding_dimension_mismatch")
    params = [ _vector_literal(query_vector) ]
    conditions = []
    if filters.get("source_id"):
        conditions.append("d.source_id = %s")
        params.append(filters["source_id"])
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    rows = connection.execute(f"""
        SELECT c.chunk_id, c.document_id, c.document_version, c.chunk_index,
               c.text, c.start_offset, c.end_offset, c.embedding_model_id,
               d.title, d.source_id, d.canonical_url, d.published_at,
               d.retrieved_at, d.normalized_text,
               1 - (c.embedding <=> %s::vector) AS score
        FROM chunks c
        JOIN documents d USING (document_id, document_version)
        {where}
        ORDER BY c.embedding <=> %s::vector
        LIMIT 100
    """, params + [_vector_literal(query_vector)]).fetchall()

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
        })
    results.sort(key=lambda item: (-item["score"], item["chunk_id"]))
    return {
        "query": query,
        "filters": filters,
        "index_snapshot": {"embedding_model_id": getattr(embedder, "model_id", None), "threshold": threshold},
        "results": results[:k],
        "limitations": [] if results else ["brak pasujących fragmentów w korpusie"],
        "errors": [],
    }
