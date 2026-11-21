import math

import pytest

from scripts.retrieval import search


class FakeEmbedder:
    model_id = "fake-e5"
    dimension = 3

    def embed_query(self, text):
        lower = text.lower()
        if "kolej" in lower or "kolei" in lower:
            return [1.0, 0.0, 0.0]
        if "mieszkań" in lower:
            return [0.0, 1.0, 0.0]
        return [0.0, 0.0, 1.0]


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, _query, _params):
        vector = [float(value) for value in _params[0].strip("[]").split(",")]
        rows = [{**row, "score": sum(a * b for a, b in zip(vector, row["embedding"]))} for row in self.rows]
        return FakeCursor(rows)


ROWS = [
    {
        "chunk_id": "d1:1:0",
        "document_id": "d1",
        "document_version": 1,
        "chunk_index": 0,
        "text": "Operacja chroni bezpieczeństwo kolei.",
        "start_offset": 0,
        "end_offset": 37,
        "embedding_model_id": "fake-e5",
        "embedding": [1.0, 0.0, 0.0],
        "title": "Operacja kolejowa",
        "source_id": "policja",
        "canonical_url": "https://policja.pl/a",
        "published_at": "2026-11-21T08:00:00+01:00",
        "retrieved_at": "2026-11-21T09:00:00+00:00",
        "normalized_text": "Operacja chroni bezpieczeństwo kolei.",
    },
    {
        "chunk_id": "d2:1:0",
        "document_id": "d2",
        "document_version": 1,
        "chunk_index": 0,
        "text": "Policjanci pomagają mieszkańcom.",
        "start_offset": 0,
        "end_offset": 33,
        "embedding_model_id": "fake-e5",
        "embedding": [0.0, 1.0, 0.0],
        "title": "Pomoc policjantów",
        "source_id": "policja",
        "canonical_url": "https://policja.pl/b",
        "published_at": None,
        "retrieved_at": "2026-11-21T09:00:00+00:00",
        "normalized_text": "Policjanci pomagają mieszkańcom.",
    },
]


def test_search_returns_ranked_literal_quote_and_offsets():
    response = search("co z bezpieczeństwem kolei?", 2, {}, FakeConnection(ROWS), FakeEmbedder(), threshold=0.5)

    assert response["errors"] == []
    assert response["results"][0]["document_id"] == "d1"
    assert response["results"][0]["score"] == pytest.approx(1.0)
    assert response["results"][0]["quoted_text"] == ROWS[0]["normalized_text"]
    assert ROWS[0]["normalized_text"][0:37] == response["results"][0]["quoted_text"]


def test_search_distinguishes_no_match_from_error():
    response = search("pogoda morska", 3, {}, FakeConnection(ROWS), FakeEmbedder(), threshold=0.99)

    assert response["results"] == []
    assert response["limitations"] == ["brak pasujących fragmentów w korpusie"]
    assert response["errors"] == []


def test_search_rejects_invalid_query_and_k():
    with pytest.raises(ValueError, match="query_empty"):
        search("", 3, {}, FakeConnection(ROWS), FakeEmbedder())
    with pytest.raises(ValueError, match="k_out_of_range"):
        search("kolej", 21, {}, FakeConnection(ROWS), FakeEmbedder())
