"""FastAPI adapter for the retrieval and versioned-corpus contract."""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager, contextmanager
from datetime import date
from typing import Literal

from fastapi import Request
from pydantic import BaseModel, Field

from scripts.corpus_versions import (
    BatchValidationError,
    DocumentNotFound,
    MAX_LIST_LIMIT,
    document_history,
    ensure_schema,
    list_documents,
    read_revision,
    replace_documents,
    schema_kind,
)
from scripts.ingest_corpus import SentenceTransformerEmbedder
from scripts.retrieval import MAX_K, search


logger = logging.getLogger("prawdowid.api")


class ClaimPeriod(BaseModel):
    start: date
    end: date


class FreshnessRule(BaseModel):
    binding_id: str = Field(min_length=1)
    days: int = Field(ge=0)


class SearchRequest(BaseModel):
    query: str = Field(min_length=0, max_length=1000)
    k: int = Field(default=5, ge=1, le=MAX_K)
    filters: dict = Field(default_factory=dict)
    publisher_ids: list[str] | None = None
    binding_ids: list[str] | None = None
    mode: Literal["today", "historical"] = "today"
    today: date | None = None
    claim_period: ClaimPeriod | None = None
    freshness: list[FreshnessRule] = Field(default_factory=list)


def _connection():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "knowledge_base_main"),
        user=os.environ.get("POSTGRES_USER", "knowledge_base"),
        password=os.environ.get("POSTGRES_PASSWORD", "knowledge_base_local_only"),
        row_factory=dict_row,
        # Reads autocommit; writes (ensure_schema, /documents batch) run in explicit `transaction()` blocks,
        # which are then real BEGIN/COMMIT rather than savepoints of an implicit transaction.
        autocommit=True,
    )


def _errors(status_code: int, code: str, message: str | None = None):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status_code, content={"errors": [{"code": code, "message": message or code}]})


def create_app(connection=None, embedder=None, migrate: bool | None = None):
    """`connection`/`embedder` are injectable for tests. With a real database (connection=None) the schema
    migration (infra/postgres/migrations/002-versioned-corpus.sql) is applied at startup, idempotently, and
    retried on the first request if the database was not reachable at startup."""
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    should_migrate = (connection is None) if migrate is None else migrate
    schema_state = {"ready": not should_migrate}
    schema_lock = threading.Lock()

    def _ensure(db):
        if schema_state["ready"]:
            return
        with schema_lock:
            if not schema_state["ready"]:
                ensure_schema(db)
                schema_state["ready"] = True

    @contextmanager
    def owned_connection():
        if connection is not None:
            _ensure(connection)
            yield connection
            return
        with _connection() as owned:
            _ensure(owned)
            yield owned

    @asynccontextmanager
    async def lifespan(_app):
        if should_migrate:
            try:
                with owned_connection():
                    pass
                logger.info("corpus schema is versioned")
            except Exception as error:  # database may come up later; retried per request
                logger.warning("schema migration deferred: %s", type(error).__name__)
        yield

    app = FastAPI(title="Prawdowid Retrieval API", version="0.2.0", lifespan=lifespan)
    active_embedder = embedder or SentenceTransformerEmbedder(os.environ.get("PRAWDOWID_EMBEDDING_MODEL", "intfloat/multilingual-e5-small"))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError):
        errors = [{"code": "invalid_request", "message": f"{'.'.join(str(part) for part in item.get('loc', ()))}: {item.get('msg')}"}
                  for item in error.errors()]
        return JSONResponse(status_code=400, content={"errors": errors})

    @app.get("/health")
    def health():
        try:
            with owned_connection() as db:
                documents = db.execute("SELECT count(*) AS count FROM documents").fetchone()["count"]
                chunks = db.execute("SELECT count(*) AS count FROM chunks").fetchone()["count"]
                schema = schema_kind(db)
                revision = read_revision(db) if schema == "versioned" else 0
            return {"status": "ok", "documents": documents, "chunks": chunks, "embedding_model_id": active_embedder.model_id,
                    "corpus_revision": revision, "schema": schema}
        except Exception as error:
            raise HTTPException(status_code=503, detail={"errors": [{"code": "health_failed", "message": type(error).__name__}]}) from error

    @app.get("/revision")
    def revision():
        try:
            with owned_connection() as db:
                return {"corpus_revision": read_revision(db)}
        except Exception as error:
            return _errors(500, "revision_failed", type(error).__name__)

    @app.post("/search")
    def search_endpoint(request: SearchRequest):
        try:
            with owned_connection() as db:
                result = search(
                    request.query, request.k, request.filters, db, active_embedder,
                    publisher_ids=request.publisher_ids, binding_ids=request.binding_ids, mode=request.mode,
                    today=request.today,
                    claim_period=request.claim_period.model_dump() if request.claim_period else None,
                    freshness=[rule.model_dump() for rule in request.freshness],
                )
                result["corpus_revision"] = read_revision(db)
                return result
        except ValueError as error:
            return _errors(400, str(error))
        except Exception as error:
            return _errors(500, "retrieval_failed", type(error).__name__)

    @app.post("/documents")
    async def put_documents(request: Request):
        try:
            payload = await request.json()
        except Exception:
            return _errors(400, "invalid_json", "Body is not valid JSON.")
        try:
            with owned_connection() as db:
                return replace_documents(payload, db, active_embedder)
        except BatchValidationError as error:
            return JSONResponse(status_code=400, content={"errors": error.errors})
        except ValueError as error:
            return _errors(400, str(error))
        except Exception as error:
            logger.exception("documents batch failed")
            return _errors(500, "documents_write_failed", type(error).__name__)

    @app.get("/documents")
    def get_documents(publisher_id: str | None = None, binding_id: str | None = None, q: str | None = None,
                      on_date: date | None = Query(default=None, alias="date"), include_superseded: Literal["0", "1"] = "0", limit: int = 100):
        if not 1 <= limit <= MAX_LIST_LIMIT:
            return _errors(400, "limit_out_of_range", f"limit must be 1..{MAX_LIST_LIMIT}")
        try:
            with owned_connection() as db:
                documents = list_documents(db, publisher_id=publisher_id, binding_id=binding_id, q=q, on_date=on_date,
                                           include_superseded=include_superseded == "1", limit=limit)
                return {"documents": documents, "corpus_revision": read_revision(db)}
        except ValueError as error:
            return _errors(400, str(error))
        except Exception as error:
            return _errors(500, "documents_read_failed", type(error).__name__)

    @app.get("/documents/{document_id:path}/versions")
    def get_versions(document_id: str):
        try:
            with owned_connection() as db:
                return document_history(db, document_id)
        except DocumentNotFound:
            return _errors(404, "document_not_found", f"Unknown document_id: {document_id}")
        except Exception as error:
            return _errors(500, "documents_read_failed", type(error).__name__)

    return app


app = create_app
