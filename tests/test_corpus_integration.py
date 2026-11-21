"""Optional: replace + today/historical selection against a real PostgreSQL + pgvector.

Runs only with PRAWDOWID_TEST_DATABASE=1 and a reachable database (POSTGRES_HOST/PORT/DB/USER/PASSWORD,
same defaults as scripts/api.py). Uses document ids prefixed `itest:` and removes them afterwards.
"""

import hashlib
import math
import os
import re
from datetime import date

import pytest

if os.environ.get("PRAWDOWID_TEST_DATABASE") != "1":
    pytest.skip("set PRAWDOWID_TEST_DATABASE=1 to run database integration tests", allow_module_level=True)

psycopg = pytest.importorskip("psycopg")

from scripts.corpus_versions import (  # noqa: E402
    content_hash,
    document_history,
    ensure_schema,
    list_documents,
    read_revision,
    replace_documents,
    select_version,
)
from scripts.retrieval import search  # noqa: E402


PREFIX = "itest:"
PUBLISHER = "itest_pub"
BINDING = "itest_binding"


class HashingEmbedder:
    """Deterministic bag-of-words embedder with the production dimension (384)."""

    model_id = "itest-hashing"
    dimension = 384

    def _embed(self, text):
        text = re.sub(r"^(query|passage):\s*", "", text)
        vector = [0.0] * self.dimension
        for token in re.findall(r"\w+", text.lower()):
            vector[int(hashlib.sha256(token.encode()).hexdigest(), 16) % self.dimension] += 1.0
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]

    def embed_passages(self, texts):
        return [self._embed(text) for text in texts]

    def embed_query(self, text):
        return self._embed(text)


def _connect():
    from psycopg.rows import dict_row

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        dbname=os.environ.get("POSTGRES_DB", "knowledge_base_main"),
        user=os.environ.get("POSTGRES_USER", "knowledge_base"),
        password=os.environ.get("POSTGRES_PASSWORD", "knowledge_base_local_only"),
        row_factory=dict_row,
        connect_timeout=3,
        autocommit=True,  # same as scripts/api.py: transaction() blocks are real commits
    )


def _committed_revision():
    with _connect() as other:
        return read_revision(other)


@pytest.fixture()
def db():
    try:
        connection = _connect()
    except psycopg.OperationalError as error:
        pytest.skip(f"database not reachable: {type(error).__name__}")
    ensure_schema(connection)
    ensure_schema(connection)  # idempotent

    def cleanup():
        with connection.transaction():
            connection.execute("DELETE FROM chunks WHERE document_id LIKE %s", (PREFIX + "%",))
            connection.execute("DELETE FROM documents WHERE document_id LIKE %s", (PREFIX + "%",))

    cleanup()
    yield connection
    cleanup()
    connection.close()


def _doc(document_id, text, **overrides):
    document = {
        "document_id": PREFIX + document_id, "publisher_id": PUBLISHER, "binding_id": BINDING,
        "kind": "standing_state", "title": "Ostrzeżenie podróżne", "canonical_url": "https://example.test/advice",
        "published_at": None, "retrieved_at": "2026-11-22T10:00:00Z", "effective_from": None, "effective_to": None,
        "text": text, "language": "pl", "license_status": "test", "test_data": True,
    }
    document.update(overrides)
    return document


V1 = _doc("standing", "Ostrzeżenie: podróże do Krainy Testowej są odradzane.", effective_from="2024-01-01")
V2 = _doc("standing", "Ostrzeżenie: podróże do Krainy Testowej są dozwolone.", published_at="2025-06-01T10:00:00Z")
DATED = _doc("dated", "Komunikat: podróże do Krainy Testowej omówiono na konferencji.", kind="dated_statement",
             published_at="2026-11-21T08:00:00+01:00", binding_id=BINDING)


def _versions(db, **kwargs):
    response = search("podróże do Krainy Testowej", 20, {}, db, HashingEmbedder(), threshold=-1.0,
                      publisher_ids=kwargs.pop("publisher_ids", [PUBLISHER]), binding_ids=kwargs.pop("binding_ids", [BINDING]), **kwargs)
    assert response["errors"] == []
    found = {}
    for item in response["results"]:
        found.setdefault(item["document_id"].removeprefix(PREFIX), set()).add((item["document_version"], item["stale"]))
    return found


def test_replace_then_today_and_historical_selection(db):
    start = read_revision(db)
    first = replace_documents({"documents": [V1, DATED]}, db, HashingEmbedder())
    assert [item["status"] for item in first["results"]] == ["new", "new"]
    assert first["corpus_revision"] == start + 1

    second = replace_documents({"documents": [V2, DATED]}, db, HashingEmbedder())
    assert [(item["version"], item["status"]) for item in second["results"]] == [(2, "changed"), (1, "unchanged")]
    assert second["corpus_revision"] == start + 2
    assert _committed_revision() == start + 2  # visible from another connection: the batch was committed

    noop = replace_documents({"documents": [V2, DATED]}, db, HashingEmbedder())
    assert [item["status"] for item in noop["results"]] == ["unchanged", "unchanged"]
    assert noop["corpus_revision"] == start + 2

    # One current row per document; v1 superseded.
    history = document_history(db, PREFIX + "standing")["versions"]
    assert [(item["version"], item["status"]) for item in history] == [(2, "current"), (1, "superseded")]
    assert history[1]["superseded_at"] and history[0]["text"] == V2["text"]

    assert _versions(db, today="2026-11-22") == {"standing": {(2, False)}, "dated": {(1, False)}}
    assert _versions(db, today="2026-11-22", freshness=[{"binding_id": BINDING, "days": 30}]) == {
        "standing": {(2, True)}, "dated": {(1, False)}}
    assert _versions(db, mode="historical", claim_period={"start": "2024-03-01", "end": "2024-03-31"}) == {
        "standing": {(1, False)}, "dated": {(1, False)}}
    assert _versions(db, mode="historical", claim_period={"start": "2025-05-01", "end": "2025-07-01"})["standing"] == {(2, False)}
    assert "standing" not in _versions(db, mode="historical", claim_period={"start": "2023-01-01", "end": "2023-12-31"})
    # Before v2 took effect, "today" falls in v1's window but today mode only ever uses the current version.
    assert "standing" not in _versions(db, today="2025-01-01")

    # Filters: other publisher, empty lists.
    assert _versions(db, publisher_ids=["someone_else"]) == {}
    assert _versions(db, binding_ids=[]) == {}

    # SQL selection agrees with the reference implementation.
    rows = [dict(row) for row in db.execute(
        "SELECT document_version, status, kind, effective_from, effective_to, published_at, retrieved_at "
        "FROM documents WHERE document_id = %s", (PREFIX + "standing",)).fetchall()]
    for period in [("2024-03-01", "2024-03-31"), ("2025-05-01", "2025-07-01"), ("2023-01-01", "2023-12-31"), ("2025-05-31", "2025-05-31")]:
        expected = select_version(rows, "historical", date(2026, 11, 22), (date.fromisoformat(period[0]), date.fromisoformat(period[1])))
        found = _versions(db, mode="historical", claim_period={"start": period[0], "end": period[1]}).get("standing", set())
        assert found == ({(expected["document_version"], False)} if expected else set()), period

    # Listing: dated view returns the version valid then (superseded included), not the current one.
    on_date = list_documents(db, publisher_id=PUBLISHER, on_date="2024-06-01")
    assert [(item["document_id"], item["version"], item["status"]) for item in on_date] == [(PREFIX + "standing", 1, "superseded")]
    current = list_documents(db, publisher_id=PUBLISHER)
    assert {(item["document_id"], item["version"]) for item in current} == {(PREFIX + "standing", 2), (PREFIX + "dated", 1)}
    everything = list_documents(db, publisher_id=PUBLISHER, include_superseded=True)
    assert len(everything) == 3
    assert list_documents(db, publisher_id=PUBLISHER, q="konferencji")[0]["document_id"] == PREFIX + "dated"


def test_legacy_row_is_adopted_and_rejected_batch_writes_nothing(db):
    text = "Legacy: komunikat z kanału RSS o Krainie Testowej."
    with db.transaction():
        db.execute("""
            INSERT INTO documents (document_id, document_version, source_id, canonical_url, title, language, published_at,
                retrieved_at, content_hash, content_status, license_status, normalized_text, published_at_source)
            VALUES (%s, 1, 'legacy_rss', 'https://example.test/legacy', 'Legacy', 'pl', '2026-11-20T10:00:00Z',
                '2026-11-20T11:00:00Z', %s, 'usable', 'test', %s, 'rss')
        """, (PREFIX + "legacy", content_hash(text), text))
    start = read_revision(db)
    adopted = replace_documents({"documents": [_doc("legacy", text, kind="dated_statement")]}, db, HashingEmbedder())
    assert adopted["results"] == [{"document_id": PREFIX + "legacy", "version": 1, "status": "adopted"}]
    assert adopted["corpus_revision"] == start + 1
    row = db.execute("SELECT publisher_id, binding_id, status FROM documents WHERE document_id = %s", (PREFIX + "legacy",)).fetchone()
    assert row == {"publisher_id": PUBLISHER, "binding_id": BINDING, "status": "current"}

    from scripts.corpus_versions import BatchValidationError

    with pytest.raises(BatchValidationError):
        replace_documents({"documents": [_doc("never", "x"), _doc("bad", "y", kind="rumour")]}, db, HashingEmbedder())
    assert db.execute("SELECT count(*) AS n FROM documents WHERE document_id = %s", (PREFIX + "never",)).fetchone()["n"] == 0
    assert read_revision(db) == start + 1
