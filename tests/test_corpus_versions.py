"""Replace-batch semantics (new / unchanged / changed / adopted), one transaction, one revision bump."""

from contextlib import contextmanager
from datetime import datetime, timezone

import pytest

from scripts.corpus_versions import BatchValidationError, content_hash, replace_documents


class FakeEmbedder:
    model_id = "fake-e5"
    dimension = 3

    def embed_passages(self, texts):
        assert all(text.startswith("passage: ") for text in texts)
        return [[1.0, 0.0, 0.0] for _ in texts]


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    """Tiny in-memory stand-in that understands exactly the statements replace_documents issues."""

    def __init__(self, documents=None, revision=0):
        self.documents = [dict(item) for item in documents or []]
        self.chunks = []
        self.revision = revision
        self.transactions = 0
        self.statements = []

    @contextmanager
    def transaction(self):
        self.transactions += 1
        snapshot = ([dict(item) for item in self.documents], list(self.chunks), self.revision)
        try:
            yield
        except Exception:
            self.documents, self.chunks, self.revision = snapshot
            raise

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.statements.append(sql)
        if sql.startswith("SELECT pg_advisory_xact_lock"):
            return Cursor([])
        if sql.startswith("SELECT document_id, document_version, publisher_id"):
            ids = params[0]
            return Cursor([dict(row) for row in self.documents if row["document_id"] in ids and row["status"] == "current"])
        if sql.startswith("SELECT document_id, max(document_version)"):
            ids = params[0]
            result = {}
            for row in self.documents:
                if row["document_id"] in ids:
                    result[row["document_id"]] = max(result.get(row["document_id"], 0), row["document_version"])
            return Cursor([{"document_id": key, "max_version": value} for key, value in result.items()])
        if sql.startswith("UPDATE documents SET status = 'superseded'"):
            for row in self.documents:
                if row["document_id"] == params[0] and row["status"] == "current":
                    row.update(status="superseded", superseded_at=datetime.now(timezone.utc))
            return Cursor([])
        if sql.startswith("UPDATE documents SET publisher_id"):
            for row in self.documents:
                if row["document_id"] == params["document_id"] and row["document_version"] == params["document_version"]:
                    row.update({key: params[key] for key in ("publisher_id", "binding_id", "kind", "title", "canonical_url",
                                                             "published_at", "effective_from", "effective_to", "test_data")})
            return Cursor([])
        if sql.startswith("INSERT INTO documents"):
            assert not any(row["document_id"] == params["document_id"] and row["status"] == "current" for row in self.documents), \
                "one-current rule violated"
            self.documents.append({**params, "status": "current"})
            return Cursor([])
        if sql.startswith("INSERT INTO chunks"):
            self.chunks.append(params)
            return Cursor([])
        if sql.startswith("INSERT INTO corpus_meta"):
            self.revision += 1
            return Cursor([{"value": self.revision}])
        if sql.startswith("SELECT value FROM corpus_meta"):
            return Cursor([{"value": self.revision}])
        raise AssertionError(f"unexpected SQL: {sql}")

    def current(self, document_id):
        return [row for row in self.documents if row["document_id"] == document_id and row["status"] == "current"]


def _doc(document_id="upload:policja:abc", text="Komunikat policji o operacji TOR.", **overrides):
    document = {
        "document_id": document_id, "publisher_id": "policja", "binding_id": "policja_upload",
        "kind": "dated_statement", "title": "Operacja TOR", "canonical_url": "https://policja.pl/a",
        "published_at": "2026-11-21T08:00:00+01:00", "retrieved_at": "2026-11-22T10:00:00Z",
        "effective_from": None, "effective_to": None, "text": text, "language": "pl",
        "license_status": "conditional", "test_data": True,
    }
    document.update(overrides)
    return document


def test_new_then_unchanged_does_not_bump_revision():
    db = FakeDB()
    first = replace_documents({"documents": [_doc()]}, db, FakeEmbedder())
    assert first == {"results": [{"document_id": "upload:policja:abc", "version": 1, "status": "new"}], "corpus_revision": 1}
    assert db.chunks[0]["chunk_id"] == "upload:policja:abc:1:0"
    assert db.documents[0]["source_id"] == "policja_upload"
    assert db.documents[0]["content_status"] == "usable"
    assert db.documents[0]["published_at_source"] == "registry"

    # Re-fetch: same text and identity, different retrieved_at -> unchanged, no revision bump.
    again = replace_documents({"documents": [_doc(retrieved_at="2026-11-23T10:00:00Z")]}, db, FakeEmbedder())
    assert again == {"results": [{"document_id": "upload:policja:abc", "version": 1, "status": "unchanged"}], "corpus_revision": 1}
    assert len(db.documents) == 1


def test_changed_text_or_identity_creates_next_version_and_supersedes():
    db = FakeDB()
    replace_documents({"documents": [_doc()]}, db, FakeEmbedder())
    changed = replace_documents({"documents": [_doc(text="Nowa treść komunikatu.")]}, db, FakeEmbedder())
    assert changed["results"] == [{"document_id": "upload:policja:abc", "version": 2, "status": "changed"}]
    retitled = replace_documents({"documents": [_doc(text="Nowa treść komunikatu.", title="Inny tytuł")]}, db, FakeEmbedder())
    assert retitled["results"][0] == {"document_id": "upload:policja:abc", "version": 3, "status": "changed"}
    # Reverting to the first text is allowed (no UNIQUE(document_id, content_hash)).
    reverted = replace_documents({"documents": [_doc()]}, db, FakeEmbedder())
    assert reverted["results"][0]["version"] == 4
    assert [row["status"] for row in sorted(db.documents, key=lambda r: r["document_version"])] == ["superseded"] * 3 + ["current"]
    assert all(row["superseded_at"] for row in db.documents if row["status"] == "superseded")
    assert reverted["corpus_revision"] == 4
    assert db.chunks[-1]["chunk_id"] == "upload:policja:abc:4:0"


def test_legacy_row_with_same_text_is_adopted_in_place():
    text = "Treść z korpusu RSS."
    legacy = {"document_id": "s02_policja_rss:1", "document_version": 1, "publisher_id": None, "binding_id": None,
              "kind": "dated_statement", "title": "Stary tytuł", "canonical_url": "https://policja.pl/r",
              "published_at": datetime(2026, 11, 21, 7, tzinfo=timezone.utc), "effective_from": None, "effective_to": None,
              "content_hash": content_hash(text), "status": "current"}
    db = FakeDB([legacy], revision=7)
    adopted = replace_documents({"documents": [_doc("s02_policja_rss:1", text=text)]}, db, FakeEmbedder())
    assert adopted == {"results": [{"document_id": "s02_policja_rss:1", "version": 1, "status": "adopted"}], "corpus_revision": 8}
    assert len(db.documents) == 1 and db.chunks == []
    assert db.documents[0]["publisher_id"] == "policja" and db.documents[0]["binding_id"] == "policja_upload"
    # Adopted rows now carry the registry identity, so the same batch again is unchanged.
    again = replace_documents({"documents": [_doc("s02_policja_rss:1", text=text)]}, db, FakeEmbedder())
    assert again["results"][0]["status"] == "unchanged" and again["corpus_revision"] == 8


def test_legacy_row_with_different_text_gets_new_version():
    legacy = {"document_id": "s02_policja_rss:1", "document_version": 1, "publisher_id": None, "binding_id": None,
              "kind": "dated_statement", "title": "T", "canonical_url": "https://policja.pl/r", "published_at": None,
              "effective_from": None, "effective_to": None, "content_hash": "other", "status": "current"}
    db = FakeDB([legacy])
    result = replace_documents({"documents": [_doc("s02_policja_rss:1")]}, db, FakeEmbedder())
    assert result["results"][0] == {"document_id": "s02_policja_rss:1", "version": 2, "status": "changed"}


def test_mixed_batch_is_one_transaction_with_one_revision_bump():
    db = FakeDB()
    replace_documents({"documents": [_doc("a"), _doc("b")]}, db, FakeEmbedder())
    assert db.revision == 1
    result = replace_documents({"documents": [_doc("a"), _doc("b", text="Zmiana."), _doc("c")]}, db, FakeEmbedder())
    assert [item["status"] for item in result["results"]] == ["unchanged", "changed", "new"]
    assert result["corpus_revision"] == 2
    assert db.transactions == 2
    assert sum(1 for sql in db.statements if sql.startswith("INSERT INTO corpus_meta")) == 2


def test_validation_error_writes_nothing():
    db = FakeDB()
    payload = {"documents": [_doc("ok"), _doc("bad", kind="rumour"), _doc("ok"), {"document_id": "x"}]}
    with pytest.raises(BatchValidationError) as raised:
        replace_documents(payload, db, FakeEmbedder())
    codes = {error["code"] for error in raised.value.errors}
    assert {"invalid_kind", "duplicate_document_id", "missing_field"} <= codes
    assert db.statements == [] and db.documents == []


def test_invalid_dates_are_rejected():
    db = FakeDB()
    with pytest.raises(BatchValidationError) as raised:
        replace_documents({"documents": [_doc(effective_from="2026-13-01"), _doc("y", effective_from="2026-02-01", effective_to="2026-01-01"),
                                         _doc("z", published_at="yesterday")]}, db, FakeEmbedder())
    assert {error["code"] for error in raised.value.errors} == {"invalid_date", "invalid_effective_window", "invalid_timestamp"}


def test_failure_mid_batch_rolls_back_everything():
    class Exploding(FakeEmbedder):
        def embed_passages(self, texts):
            if any("BOOM" in text for text in texts):
                raise RuntimeError("embedder down")
            return super().embed_passages(texts)

    db = FakeDB()
    with pytest.raises(RuntimeError):
        replace_documents({"documents": [_doc("a"), _doc("b", text="BOOM.")]}, db, Exploding())
    assert db.documents == [] and db.chunks == [] and db.revision == 0
