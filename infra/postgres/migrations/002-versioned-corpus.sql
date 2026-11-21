-- 002: versioned, registry-aware corpus.
-- Idempotent: safe on a fresh volume (after 001-init.sql), on an old volume, and on every
-- retrieval API / ingest start (scripts/corpus_versions.py:ensure_schema runs it in one transaction).
-- Keep this file free of percent signs: it is sent through psycopg without parameters.

-- Serialize concurrent upgrades when run inside one transaction (no-op under psql autocommit).
SELECT pg_advisory_xact_lock(4207202);

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS publisher_id TEXT,
    ADD COLUMN IF NOT EXISTS binding_id TEXT,
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'dated_statement',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'current',
    ADD COLUMN IF NOT EXISTS effective_from DATE,
    ADD COLUMN IF NOT EXISTS effective_to DATE,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS test_data BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_kind_check') THEN
        ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('dated_statement', 'standing_state'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_status_check') THEN
        ALTER TABLE documents ADD CONSTRAINT documents_status_check CHECK (status IN ('current', 'superseded'));
    END IF;
END $$;

-- The old UNIQUE (document_id, content_hash) must go: a replacement may revert to an earlier text.
DO $$
DECLARE
    old_constraint RECORD;
BEGIN
    FOR old_constraint IN
        SELECT con.conname
        FROM pg_constraint con
        WHERE con.conrelid = 'public.documents'::regclass
          AND con.contype = 'u'
          AND (
              SELECT array_agg(att.attname::TEXT ORDER BY att.attname)
              FROM pg_attribute att
              WHERE att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
          ) = ARRAY['content_hash', 'document_id']
    LOOP
        EXECUTE 'ALTER TABLE documents DROP CONSTRAINT ' || quote_ident(old_constraint.conname);
    END LOOP;
END $$;

-- Legacy ingest could leave several versions of one document; only the newest stays current.
UPDATE documents d
SET status = 'superseded', superseded_at = COALESCE(d.superseded_at, now())
WHERE d.status = 'current'
  AND EXISTS (
      SELECT 1 FROM documents newer
      WHERE newer.document_id = d.document_id AND newer.document_version > d.document_version
  );

CREATE UNIQUE INDEX IF NOT EXISTS documents_one_current_idx ON documents (document_id) WHERE status = 'current';
CREATE INDEX IF NOT EXISTS documents_registry_idx ON documents (publisher_id, binding_id);

CREATE TABLE IF NOT EXISTS corpus_meta (
    key TEXT PRIMARY KEY,
    value BIGINT NOT NULL
);
INSERT INTO corpus_meta (key, value) VALUES ('corpus_revision', 0) ON CONFLICT (key) DO NOTHING;
