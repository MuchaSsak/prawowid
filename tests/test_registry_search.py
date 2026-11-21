"""Registry-mode search: filters and the version rule are SQL predicates applied before the vector ranking."""

from datetime import date

import pytest

from scripts.corpus_versions import select_version, version_windows
from scripts.retrieval import search


class FakeEmbedder:
    model_id = "fake-e5"
    dimension = 3

    def embed_query(self, _text):
        return [1.0, 0.0, 0.0]


class RecordingConnection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls = []

    def execute(self, query, params=None):
        self.calls.append((query, params))
        rows = self.rows

        class Cursor:
            def fetchall(self):
                return rows

        return Cursor()


def _row(**overrides):
    text = "Ostrzeżenie dla podróżnych obowiązuje."
    row = {
        "chunk_id": "doc:2:0", "document_id": "doc", "document_version": 2, "chunk_index": 0,
        "text": text, "start_offset": 0, "end_offset": len(text), "embedding_model_id": "fake-e5",
        "title": "Ostrzeżenie", "source_id": "msz_advice", "canonical_url": "https://www.gov.pl/web/dyplomacja/x",
        "published_at": "2026-10-01T08:00:00+00:00", "retrieved_at": "2026-10-01T09:00:00+00:00",
        "normalized_text": text, "publisher_id": "msz", "binding_id": "msz_advice", "kind": "standing_state",
        "status": "current", "effective_from": date(2026, 10, 1), "effective_to": None, "score": 0.95,
    }
    row.update(overrides)
    return row


def _where_and_order(sql):
    order = sql.index("ORDER BY c.embedding <=>")
    return sql[:order], sql[order:]


def test_registry_filters_and_version_rule_precede_ranking():
    connection = RecordingConnection()
    search("ostrzeżenie", 5, {}, connection, FakeEmbedder(), publisher_ids=["msz"], binding_ids=["msz_advice"],
           mode="today", today="2026-11-22")
    sql, params = connection.calls[0]
    before, after = _where_and_order(sql)
    assert "w.publisher_id = ANY(%(publisher_ids)s)" in before
    assert "w.binding_id = ANY(%(binding_ids)s)" in before
    assert "w.kind = 'dated_statement' AND w.status = 'current'" in before
    assert "w.valid_from <= %(today)s" in before
    assert "JOIN eligible e USING (document_id, document_version)" in before
    assert "publisher_id" not in after and "status" not in after
    assert params["publisher_ids"] == ["msz"]
    assert params["binding_ids"] == ["msz_advice"]
    assert params["today"] == date(2026, 11, 22)


def test_historical_mode_uses_claim_period_overlap_before_ranking():
    connection = RecordingConnection()
    search("ostrzeżenie", 5, {}, connection, FakeEmbedder(), publisher_ids=["msz"], binding_ids=["msz_advice"],
           mode="historical", claim_period={"start": "2024-01-01", "end": "2024-12-31"})
    sql, params = connection.calls[0]
    before, _after = _where_and_order(sql)
    assert "w.overlap_rank = 1" in before
    assert "win.valid_from <= %(period_end)s" in before
    assert "win.valid_to >= %(period_start)s" in before
    assert params["period_start"] == date(2024, 1, 1) and params["period_end"] == date(2024, 12, 31)
    assert "today" not in params


@pytest.mark.parametrize("publishers,bindings", [([], ["msz_advice"]), (["msz"], []), ([], [])])
def test_empty_id_list_returns_no_results_without_querying(publishers, bindings):
    connection = RecordingConnection([_row()])
    response = search("ostrzeżenie", 5, {}, connection, FakeEmbedder(), publisher_ids=publishers, binding_ids=bindings)
    assert response["results"] == []
    assert response["errors"] == []
    assert connection.calls == []


def test_legacy_mode_reads_only_current_versions():
    connection = RecordingConnection()
    search("kolej", 5, {"source_id": "s02_policja_rss"}, connection, FakeEmbedder())
    sql, params = connection.calls[0]
    before, _after = _where_and_order(sql)
    assert "d.status = 'current'" in before
    assert "d.source_id = %s" in before
    assert "ANY(" not in sql
    assert isinstance(params, list) and params[1] == "s02_policja_rss"


def test_historical_requires_claim_period():
    with pytest.raises(ValueError, match="claim_period_required"):
        search("x", 5, {}, RecordingConnection(), FakeEmbedder(), publisher_ids=["msz"], binding_ids=["b"], mode="historical")
    with pytest.raises(ValueError, match="claim_period_invalid"):
        search("x", 5, {}, RecordingConnection(), FakeEmbedder(), publisher_ids=["msz"], binding_ids=["b"],
               mode="historical", claim_period={"start": "2025-01-01", "end": "2024-01-01"})


def test_result_carries_registry_fields_and_stale_flag():
    connection = RecordingConnection([_row()])
    fresh_rule = [{"binding_id": "msz_advice", "days": 30}]
    stale = search("x", 5, {}, connection, FakeEmbedder(), threshold=0.5, publisher_ids=["msz"], binding_ids=["msz_advice"],
                   today="2026-11-22", freshness=fresh_rule)["results"][0]
    assert stale["stale"] is True  # 52 days since published_at > 30
    assert stale["publisher_id"] == "msz" and stale["binding_id"] == "msz_advice"
    assert stale["kind"] == "standing_state" and stale["status"] == "current"
    assert stale["effective_from"] == "2026-10-01" and stale["effective_to"] is None

    not_stale = search("x", 5, {}, connection, FakeEmbedder(), threshold=0.5, publisher_ids=["msz"], binding_ids=["msz_advice"],
                       today="2026-10-20", freshness=fresh_rule)["results"][0]
    assert not_stale["stale"] is False
    no_rule = search("x", 5, {}, connection, FakeEmbedder(), threshold=0.5, publisher_ids=["msz"], binding_ids=["msz_advice"],
                     today="2026-11-22")["results"][0]
    assert no_rule["stale"] is False
    historical = search("x", 5, {}, connection, FakeEmbedder(), threshold=0.5, publisher_ids=["msz"], binding_ids=["msz_advice"],
                        mode="historical", claim_period={"start": "2026-10-01", "end": "2026-10-31"}, freshness=fresh_rule)["results"][0]
    assert historical["stale"] is False


def test_k_up_to_twenty():
    search("x", 20, {}, RecordingConnection(), FakeEmbedder())
    with pytest.raises(ValueError, match="k_out_of_range"):
        search("x", 21, {}, RecordingConnection(), FakeEmbedder())


# ── version rule (reference implementation mirrored by the SQL) ──

STANDING = [
    {"document_version": 1, "status": "superseded", "kind": "standing_state", "effective_from": "2024-01-01",
     "effective_to": None, "published_at": "2024-01-01T10:00:00+00:00", "retrieved_at": "2024-01-02T00:00:00+00:00"},
    {"document_version": 2, "status": "current", "kind": "standing_state", "effective_from": None,
     "effective_to": None, "published_at": "2025-06-01T10:00:00+00:00", "retrieved_at": "2025-06-02T00:00:00+00:00"},
]


def test_windows_close_at_next_version_start():
    windows = version_windows(STANDING)
    assert windows[0]["valid_from"] == date(2024, 1, 1)
    assert windows[0]["valid_to"] == date(2025, 5, 31)
    assert windows[1]["valid_from"] == date(2025, 6, 1)
    assert windows[1]["valid_to"] is None


def test_today_selects_current_and_historical_selects_overlapping_version():
    assert select_version(STANDING, "today", date(2026, 11, 22))["document_version"] == 2
    assert select_version(STANDING, "historical", date(2026, 11, 22), (date(2024, 3, 1), date(2024, 3, 31)))["document_version"] == 1
    # Period spanning both windows: the highest overlapping version wins.
    assert select_version(STANDING, "historical", date(2026, 11, 22), (date(2025, 5, 1), date(2025, 7, 1)))["document_version"] == 2
    # Before any version existed.
    assert select_version(STANDING, "historical", date(2026, 11, 22), (date(2023, 1, 1), date(2023, 12, 31))) is None


def test_today_excludes_not_yet_valid_and_expired_current_version():
    future = [{**STANDING[1], "effective_from": "2027-01-01"}]
    assert select_version(future, "today", date(2026, 11, 22)) is None
    expired = [{**STANDING[1], "effective_to": "2026-01-01"}]
    assert select_version(expired, "today", date(2026, 11, 22)) is None


def test_dated_statement_is_always_current_version():
    dated = [{**item, "kind": "dated_statement"} for item in STANDING]
    assert select_version(dated, "today", date(2026, 11, 22))["document_version"] == 2
    assert select_version(dated, "historical", date(2026, 11, 22), (date(2024, 3, 1), date(2024, 3, 31)))["document_version"] == 2
