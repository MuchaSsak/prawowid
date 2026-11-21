CREATE EXTENSION IF NOT EXISTS vector;

-- One row per document version. Exactly one `current` row per document_id (partial unique index below);
-- older versions stay as `superseded` so historical (claim_period) searches can still find them.
-- Legacy rows from scripts/ingest_corpus.py have publisher_id/binding_id NULL.
CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT NOT NULL,
    document_version INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT,
    language TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    retrieved_at TIMESTAMPTZ NOT NULL,
    content_hash TEXT NOT NULL,
    content_status TEXT NOT NULL,
    license_status TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    published_at_source TEXT NOT NULL,
    publisher_id TEXT,
    binding_id TEXT,
    kind TEXT NOT NULL DEFAULT 'dated_statement',
    status TEXT NOT NULL DEFAULT 'current',
    effective_from DATE,
    effective_to DATE,
    superseded_at TIMESTAMPTZ,
    test_data BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (document_id, document_version),
    CONSTRAINT documents_kind_check CHECK (kind IN ('dated_statement', 'standing_state')),
    CONSTRAINT documents_status_check CHECK (status IN ('current', 'superseded'))
);

DO $$
DECLARE
    embedding_dimension INTEGER := COALESCE(NULLIF(current_setting('prawdowid.embedding_dimension', true), ''), '384')::INTEGER;
BEGIN
    IF to_regclass('public.chunks') IS NULL THEN
        EXECUTE format($sql$
            CREATE TABLE chunks (
                chunk_id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                document_version INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                start_offset INTEGER NOT NULL,
                end_offset INTEGER NOT NULL,
                embedding_model_id TEXT NOT NULL,
                embedding vector(%s) NOT NULL,
                text_hash TEXT NOT NULL,
                UNIQUE (document_id, document_version, chunk_index),
                FOREIGN KEY (document_id, document_version)
                    REFERENCES documents (document_id, document_version)
            )
        $sql$, embedding_dimension);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_canonical_url_idx ON documents (canonical_url);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id, document_version);
CREATE UNIQUE INDEX IF NOT EXISTS documents_one_current_idx ON documents (document_id) WHERE status = 'current';
CREATE INDEX IF NOT EXISTS documents_registry_idx ON documents (publisher_id, binding_id);

-- Single-row counters. `corpus_revision` is bumped once per committed /documents batch that changed anything.
CREATE TABLE IF NOT EXISTS corpus_meta (
    key TEXT PRIMARY KEY,
    value BIGINT NOT NULL
);
INSERT INTO corpus_meta (key, value) VALUES ('corpus_revision', 0) ON CONFLICT (key) DO NOTHING;
