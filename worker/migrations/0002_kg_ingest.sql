CREATE TABLE ingest_queue (
  id TEXT PRIMARY KEY,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 2),
  source TEXT NOT NULL CHECK (source IN ('seed', 'expansion', 'sciatlas_pointer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_at TEXT NOT NULL,
  claim_token TEXT,
  resolved_paper_id TEXT REFERENCES paper(id),
  enqueued_at TEXT NOT NULL
);
CREATE INDEX ingest_queue_due_idx ON ingest_queue(status, next_at, enqueued_at);

CREATE TABLE ingest_log (
  sequence INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  at TEXT NOT NULL,
  retry_at TEXT
);
CREATE INDEX ingest_log_pause_idx ON ingest_log(retry_at) WHERE code = 'openalex_rate_limited';
