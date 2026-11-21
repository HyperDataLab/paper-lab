-- Central lab store (ADR-0007): one row per record of every collection. Bodies live in R2
-- (`r2_key`, one immutable object per version) or, for small inline collections, in `body_json`.
-- `lab_id`, `visibility`, `created_by` and the project/corpus ids are stamped now so permissions can be
-- added later without migrating data.
CREATE TABLE doc (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  r2_key TEXT,
  body_json TEXT,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  lab_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'lab',
  project_id TEXT,
  corpus_id TEXT,
  paper_id TEXT,
  ref_id TEXT,
  doi TEXT,
  title TEXT,
  kind TEXT,
  status TEXT,
  source_sha256 TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (collection, id)
);
CREATE INDEX doc_updated ON doc (collection, updated_at);
CREATE INDEX doc_project ON doc (collection, project_id);
CREATE INDEX doc_corpus ON doc (collection, corpus_id);
CREATE INDEX doc_paper ON doc (collection, paper_id);
CREATE INDEX doc_ref ON doc (collection, ref_id);
CREATE INDEX doc_doi ON doc (collection, doi);
CREATE INDEX doc_source ON doc (collection, source_sha256);
CREATE INDEX doc_status ON doc (collection, status);
CREATE INDEX doc_kind ON doc (collection, kind);
-- One live library item per DOI, as Dexie's `&doi` index enforced.
CREATE UNIQUE INDEX doc_library_doi ON doc (collection, doi)
  WHERE collection = 'library' AND doi IS NOT NULL AND deleted_at IS NULL;

-- Append-only log of every change, for audit and later sync.
CREATE TABLE change_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
  actor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX change_log_doc ON change_log (collection, id);

-- Always empty. A commit's version guard inserts a 0 here when the version it expects is not the current
-- one; the CHECK then fails the statement, and D1 rolls the whole batch back.
CREATE TABLE version_guard (
  ok INTEGER NOT NULL CONSTRAINT version_conflict CHECK (ok = 1)
);

-- Cursor of the orphan-body garbage collector between cron runs.
CREATE TABLE data_gc_state (
  name TEXT PRIMARY KEY,
  value TEXT
);
