from scripts.ingest_corpus import build_chunks, prepare_document


class FakeEmbedder:
    model_id = "fake-e5"
    dimension = 3

    def embed_passages(self, texts):
        assert all(text.startswith("passage: ") for text in texts)
        return [[1.0, float(index), 0.0] for index, _ in enumerate(texts)]

    def embed_query(self, text):
        assert text.startswith("query: ")
        return [1.0, 0.0, 0.0]


def _document(text="Pierwsze zdanie artykułu. Drugie zdanie o kolei. Trzecie zdanie."):
    return {
        "document_id": "police:1",
        "source_id": "s02_policja_rss",
        "canonical_url": "https://policja.pl/pol/aktualnosci/1.html",
        "title": "Komunikat",
        "language": "pl",
        "published_at": "2026-11-21T08:00:00+01:00",
        "retrieved_at": "2026-11-21T12:00:00+00:00",
        "license_status": "conditional",
        "normalized_text": text,
        "content_hash": "hash-1",
        "published_at_source": "rss",
        "content_status": "usable",
        "doc_type": "article",
    }


def test_chunks_reconstruct_exact_normalized_text():
    text = _document()["normalized_text"]
    chunks = build_chunks(_document(), FakeEmbedder(), max_chars=38)
    assert chunks
    assert all(text[item["start_offset"]:item["end_offset"]] == item["text"] for item in chunks)
    assert " ".join(item["text"] for item in chunks) == text


def test_prepare_document_adds_version_and_embedding_model():
    document, chunks = prepare_document(_document(), FakeEmbedder(), max_chars=800)
    assert document["document_version"] == 1
    assert document["document_id"] == "police:1"
    assert chunks[0]["embedding_model_id"] == "fake-e5"
    assert chunks[0]["embedding"] == [1.0, 0.0, 0.0]
    assert chunks[0]["text_hash"]


def test_embedding_dimension_mismatch_is_rejected():
    class BadEmbedder(FakeEmbedder):
        dimension = 4

        def embed_passages(self, texts):
            return [[1.0, 0.0] for _ in texts]

    try:
        prepare_document(_document(), BadEmbedder())
    except ValueError as error:
        assert str(error) == "embedding_dimension_mismatch"
    else:
        raise AssertionError("dimension mismatch must be rejected")


def test_embedder_exposes_query_interface():
    embedder = FakeEmbedder()
    assert len(embedder.embed_query("query: kolej")) == embedder.dimension
