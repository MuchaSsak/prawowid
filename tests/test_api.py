import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

from scripts.api import create_app


class FakeEmbedder:
    model_id = "fake-e5"
    dimension = 3

    def embed_query(self, _text):
        return [1.0, 0.0, 0.0]


class FakeCursor:
    def fetchone(self):
        return {"value": 0}

    def fetchall(self):
        return [{
            "chunk_id": "d1:1:0", "document_id": "d1", "document_version": 1,
            "chunk_index": 0, "text": "Kolej działa.", "start_offset": 0,
            "end_offset": 13, "embedding_model_id": "fake-e5", "embedding": [1.0, 0.0, 0.0],
            "title": "Kolej", "source_id": "policja", "canonical_url": "https://policja.pl/a",
            "published_at": None, "retrieved_at": None, "normalized_text": "Kolej działa.", "score": 1.0,
        }]


class FakeConnection:
    def execute(self, _query, _params=None):
        return FakeCursor()


def test_search_endpoint_returns_contract_result():
    client = TestClient(create_app(connection=FakeConnection(), embedder=FakeEmbedder()))
    response = client.post("/search", json={"query": "kolej", "k": 3})
    assert response.status_code == 200
    assert response.json()["results"][0]["quoted_text"] == "Kolej działa."
    assert response.json()["errors"] == []


def test_search_endpoint_rejects_empty_query():
    client = TestClient(create_app(connection=FakeConnection(), embedder=FakeEmbedder()))
    response = client.post("/search", json={"query": "", "k": 3})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "query_empty"


def test_search_endpoint_returns_500_for_technical_failure():
    class BrokenConnection:
        def execute(self, *_args):
            raise RuntimeError("database down")

    client = TestClient(create_app(connection=BrokenConnection(), embedder=FakeEmbedder()))
    response = client.post("/search", json={"query": "kolej", "k": 3})
    assert response.status_code == 500
    assert response.json()["errors"][0]["code"] == "retrieval_failed"


class RouteConnection:
    """Answers the few statements the documents/revision/health endpoints issue."""

    def __init__(self):
        self.calls = []

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.calls.append((sql, params))
        rows = []
        if "FROM corpus_meta" in sql:
            rows = [{"value": 5}]
        elif "count(*) AS count" in sql:
            rows = [{"count": 2}]
        elif "information_schema.columns" in sql:
            rows = [{"count": 2}]
        elif "WHERE d.document_id = %s" in sql:
            rows = [] if params[0] == "missing" else [{
                "document_id": params[0], "document_version": 2, "publisher_id": "policja", "binding_id": "policja_upload",
                "kind": "standing_state", "status": "current", "title": "T", "canonical_url": "https://policja.pl/a",
                "published_at": None, "retrieved_at": None, "effective_from": None, "effective_to": None,
                "superseded_at": None, "content_hash": "h", "chars": 5, "test_data": True, "normalized_text": "Tekst",
            }]

        class Cursor:
            def fetchone(self):
                return rows[0] if rows else None

            def fetchall(self):
                return rows

        return Cursor()


def test_health_and_revision_report_corpus_revision():
    client = TestClient(create_app(connection=RouteConnection(), embedder=FakeEmbedder()))
    health = client.get("/health").json()
    assert health["corpus_revision"] == 5 and health["schema"] == "versioned"
    assert client.get("/revision").json() == {"corpus_revision": 5}


def test_documents_post_validation_error_is_400_and_writes_nothing():
    connection = RouteConnection()
    client = TestClient(create_app(connection=connection, embedder=FakeEmbedder()))
    response = client.post("/documents", json={"documents": [{"document_id": "x"}]})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "missing_field"
    assert connection.calls == []


def test_document_versions_404_and_history_shape():
    client = TestClient(create_app(connection=RouteConnection(), embedder=FakeEmbedder()))
    missing = client.get("/documents/missing/versions")
    assert missing.status_code == 404
    assert missing.json()["errors"][0]["code"] == "document_not_found"
    history = client.get("/documents/upload:policja:a/b/versions").json()
    assert history["document_id"] == "upload:policja:a/b"
    assert history["versions"][0]["version"] == 2 and history["versions"][0]["text"] == "Tekst"


def test_documents_list_passes_filters_and_rejects_bad_limit():
    connection = RouteConnection()
    client = TestClient(create_app(connection=connection, embedder=FakeEmbedder()))
    response = client.get("/documents", params={"publisher_id": "policja", "date": "2024-05-01", "q": "50%"})
    assert response.status_code == 200 and response.json()["corpus_revision"] == 5
    sql, params = next(call for call in connection.calls if "FROM windows d" in call[0])
    assert "d.valid_from <= %(on_date)s" in sql and "d.status = 'current'" not in sql
    assert params["publisher_id"] == "policja" and params["q"] == "%50\\%%"
    assert client.get("/documents", params={"limit": 501}).status_code == 400


def test_search_validation_errors_use_errors_envelope():
    client = TestClient(create_app(connection=RouteConnection(), embedder=FakeEmbedder()))
    response = client.post("/search", json={"query": "kolej", "k": 21})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "invalid_request"
    historical = client.post("/search", json={"query": "kolej", "publisher_ids": ["p"], "binding_ids": ["b"], "mode": "historical"})
    assert historical.status_code == 400 and historical.json()["errors"][0]["code"] == "claim_period_required"
