"""Chunk, embed and ingest the clean corpus into PostgreSQL + pgvector."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


DEFAULT_MODEL = "intfloat/multilingual-e5-small"


class Embedder(Protocol):
    model_id: str
    dimension: int

    def embed_passages(self, texts: list[str]) -> list[list[float]]: ...


class SentenceTransformerEmbedder:
    def __init__(self, model_id: str = DEFAULT_MODEL):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise RuntimeError("RAG dependencies missing; install with: pip install -e '.[rag]'") from error
        self.model_id = model_id
        self._model = SentenceTransformer(model_id)
        dimension_method = getattr(self._model, "get_embedding_dimension", None)
        if dimension_method is None:
            dimension_method = self._model.get_sentence_embedding_dimension
        self.dimension = dimension_method()

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        vectors = self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return [vector.tolist() for vector in vectors]

    def embed_query(self, text: str) -> list[float]:
        vector = self._model.encode([text], normalize_embeddings=True, show_progress_bar=False)[0]
        return vector.tolist()


def chunk_text(text: str, max_chars: int = 700) -> list[dict]:
    sentences = []
    for match in re.finditer(r".+?(?:[.!?](?:\s+|$)|$)", text, re.DOTALL):
        sentence = match.group().strip()
        if sentence:
            start = match.start() + len(match.group()) - len(match.group().lstrip())
            sentences.append((start, start + len(sentence), sentence))
    chunks: list[dict] = []
    current: list[tuple[int, int, str]] = []
    current_length = 0
    for start, end, sentence in sentences:
        proposed = current_length + (1 if current else 0) + len(sentence)
        if current and proposed > max_chars:
            chunks.append({"text": " ".join(item[2] for item in current), "start_offset": current[0][0], "end_offset": current[-1][1]})
            current = []
            current_length = 0
        current.append((start, end, sentence))
        current_length += (1 if current_length else 0) + len(sentence)
    if current:
        chunks.append({"text": " ".join(item[2] for item in current), "start_offset": current[0][0], "end_offset": current[-1][1]})
    return chunks


def build_chunks(document: dict, embedder: Embedder, max_chars: int = 700) -> list[dict]:
    raw_chunks = chunk_text(document["normalized_text"], max_chars=max_chars)
    embeddings = embedder.embed_passages([f"passage: {chunk['text']}" for chunk in raw_chunks])
    if any(len(vector) != embedder.dimension for vector in embeddings):
        raise ValueError("embedding_dimension_mismatch")
    version = document.get("document_version", 1)
    result = []
    for index, (chunk, embedding) in enumerate(zip(raw_chunks, embeddings)):
        if document["normalized_text"][chunk["start_offset"]:chunk["end_offset"]] != chunk["text"]:
            raise ValueError("chunk_offset_mismatch")
        result.append({
            "chunk_id": f"{document['document_id']}:{version}:{index}",
            "document_id": document["document_id"],
            "document_version": version,
            "chunk_index": index,
            "text": chunk["text"],
            "start_offset": chunk["start_offset"],
            "end_offset": chunk["end_offset"],
            "embedding_model_id": embedder.model_id,
            "embedding": embedding,
            "text_hash": hashlib.sha256(chunk["text"].encode("utf-8")).hexdigest(),
        })
    return result


def prepare_document(document: dict, embedder: Embedder, max_chars: int = 700) -> tuple[dict, list[dict]]:
    prepared = {**document, "document_version": 1}
    chunks = build_chunks(prepared, embedder, max_chars=max_chars)
    return prepared, chunks


def _connection():
    import psycopg

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "knowledge_base_main"),
        user=os.environ.get("POSTGRES_USER", "knowledge_base"),
        password=os.environ.get("POSTGRES_PASSWORD", "knowledge_base_local_only"),
    )


def ingest_rows(rows: list[dict], embedder: Embedder, connection, max_chars: int = 700) -> dict:
    report = {"discovered": len(rows), "new": 0, "changed": 0, "unchanged": 0, "rejected": 0, "failed": 0, "error_codes": {}}
    for source in rows:
        try:
            if source.get("content_status") != "usable" or not source.get("normalized_text"):
                report["rejected"] += 1
                continue
            current = connection.execute("SELECT document_version, content_hash FROM documents WHERE document_id = %s ORDER BY document_version DESC LIMIT 1", (source["document_id"],)).fetchone()
            if current and current[1] == source["content_hash"]:
                report["unchanged"] += 1
                continue
            version = (current[0] + 1) if current else 1
            document = {**source, "document_version": version}
            chunks = build_chunks(document, embedder, max_chars=max_chars)
            if current:
                # Versioned schema: exactly one `current` row per document_id (legacy rows keep publisher_id NULL).
                connection.execute("UPDATE documents SET status = 'superseded', superseded_at = now() WHERE document_id = %s AND status = 'current'", (source["document_id"],))
            connection.execute("""INSERT INTO documents (document_id, document_version, source_id, canonical_url, title, language, published_at, retrieved_at, content_hash, content_status, license_status, normalized_text, published_at_source)
                VALUES (%(document_id)s, %(document_version)s, %(source_id)s, %(canonical_url)s, %(title)s, %(language)s, %(published_at)s, %(retrieved_at)s, %(content_hash)s, %(content_status)s, %(license_status)s, %(normalized_text)s, %(published_at_source)s)""", document)
            for chunk in chunks:
                connection.execute("""INSERT INTO chunks (chunk_id, document_id, document_version, chunk_index, text, start_offset, end_offset, embedding_model_id, embedding, text_hash)
                    VALUES (%(chunk_id)s, %(document_id)s, %(document_version)s, %(chunk_index)s, %(text)s, %(start_offset)s, %(end_offset)s, %(embedding_model_id)s, %(embedding)s, %(text_hash)s)""", {**chunk, "embedding": str(chunk["embedding"])})
            report["changed" if current else "new"] += 1
        except Exception as error:
            report["failed"] += 1
            code = type(error).__name__
            report["error_codes"][code] = report["error_codes"].get(code, 0) + 1
    if report["new"] or report["changed"]:
        connection.execute("""INSERT INTO corpus_meta (key, value) VALUES ('corpus_revision', 1)
            ON CONFLICT (key) DO UPDATE SET value = corpus_meta.value + 1""")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/corpus/policja-clean.jsonl"))
    parser.add_argument("--model", default=os.environ.get("PRAWDOWID_EMBEDDING_MODEL", DEFAULT_MODEL))
    parser.add_argument("--chunk-size", type=int, default=700)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.input.read_text(encoding="utf-8").splitlines() if line.strip()]
    embedder = SentenceTransformerEmbedder(args.model)
    with _connection() as connection:
        from scripts.corpus_versions import ensure_schema

        ensure_schema(connection)
        report = ingest_rows(rows, embedder, connection, max_chars=args.chunk_size)
    print(json.dumps({**report, "embedding_model_id": embedder.model_id, "embedding_dimension": embedder.dimension}, ensure_ascii=False))
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
