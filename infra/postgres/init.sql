CREATE EXTENSION IF NOT EXISTS vector;

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
    PRIMARY KEY (document_id, document_version),
    UNIQUE (document_id, content_hash)
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
