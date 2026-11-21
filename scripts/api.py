"""FastAPI adapter for the retrieval contract."""

from __future__ import annotations

import os
from contextlib import contextmanager

from pydantic import BaseModel, Field

from scripts.ingest_corpus import SentenceTransformerEmbedder
from scripts.retrieval import search


class SearchRequest(BaseModel):
    query: str = Field(min_length=0, max_length=1000)
    k: int = Field(default=5, ge=1, le=10)
    filters: dict = Field(default_factory=dict)


def _connection():
    import psycopg

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "knowledge_base_main"),
        user=os.environ.get("POSTGRES_USER", "knowledge_base"),
        password=os.environ.get("POSTGRES_PASSWORD", "knowledge_base_local_only"),
        row_factory=psycopg.rows.dict_row,
    )


@contextmanager
def _owned_connection(connection):
    if connection is not None:
        yield connection
        return
    with _connection() as owned:
        yield owned


def create_app(connection=None, embedder=None):
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import JSONResponse

    app = FastAPI(title="Prawdowid Retrieval API", version="0.1.0")
    active_embedder = embedder or SentenceTransformerEmbedder(os.environ.get("PRAWDOWID_EMBEDDING_MODEL", "intfloat/multilingual-e5-small"))

    @app.get("/health")
    def health():
        try:
            with _owned_connection(connection) as db:
                documents = db.execute("SELECT count(*) AS count FROM documents").fetchone()["count"]
                chunks = db.execute("SELECT count(*) AS count FROM chunks").fetchone()["count"]
            return {"status": "ok", "documents": documents, "chunks": chunks, "embedding_model_id": active_embedder.model_id}
        except Exception as error:
            raise HTTPException(status_code=503, detail={"errors": [{"code": "health_failed", "message": type(error).__name__}]}) from error

    @app.post("/search")
    def search_endpoint(request: SearchRequest):
        try:
            with _owned_connection(connection) as db:
                return search(request.query, request.k, request.filters, db, active_embedder)
        except ValueError as error:
            return JSONResponse(status_code=400, content={"errors": [{"code": str(error), "message": str(error)}]})
        except Exception as error:
            return JSONResponse(status_code=500, content={"errors": [{"code": "retrieval_failed", "message": type(error).__name__}]})

    return app


app = create_app
