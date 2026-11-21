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
