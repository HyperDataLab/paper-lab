-- Passage index (docs/plans/PASSAGE_INDEX.md): the paragraphs of the papers of one scope, for hybrid retrieval
-- with citation anchors (paper id + paragraph id). `project_id` is the ResearchHub project id, or 'lab' for lab
-- scope (ADR-0009). Rows are derived from `papers` records and rebuilt by the cron indexer; the embeddings live in
-- the `paperlab-passages` Vectorize index under `vector_id`.
CREATE TABLE passage (
  project_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  paragraph_id TEXT NOT NULL,
  section_role TEXT NOT NULL,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, paper_id, paragraph_id)
);
CREATE INDEX passage_vector ON passage (vector_id);

-- Porter stemming so "measure" also finds "measured" and "measuring".
CREATE VIRTUAL TABLE passage_fts USING fts5(
  text,
  content='passage',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER passage_fts_insert AFTER INSERT ON passage BEGIN
  INSERT INTO passage_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER passage_fts_delete AFTER DELETE ON passage BEGIN
  INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER passage_fts_update AFTER UPDATE OF text ON passage WHEN old.text IS NOT new.text BEGIN
  INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO passage_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- Papers waiting to be (re)indexed. `generation` grows on every enqueue, so a job finishes only when the paper did
-- not change while it ran; `next_at` doubles as the claim lease and the retry time.
CREATE TABLE passage_queue (
  project_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  enqueued_at TEXT NOT NULL,
  last_error TEXT,
  PRIMARY KEY (project_id, paper_id)
);
CREATE INDEX passage_queue_due ON passage_queue (status, next_at);

-- Every write of a `papers` record (PUT, commit or delete, which all bump `version`) queues the paper in the same
-- transaction, so the index never misses a change made through the data store. Both scopes (ADR-0009):
-- - project scope: `hub_project_id` set, id `@rh/<project>/<paper>` → (project_id = <project>, paper_id = <paper>);
-- - lab scope: `hub_project_id IS NULL`, unprefixed id → (project_id = 'lab', paper_id = id). The worker accepts
--   only UUIDs as project ids, so the 'lab' sentinel never collides with a project.
CREATE TRIGGER passage_enqueue_insert AFTER INSERT ON doc
WHEN new.collection = 'papers' AND (
  (new.hub_project_id IS NOT NULL
    AND substr(new.id, 1, length(new.hub_project_id) + 5) = '@rh/' || new.hub_project_id || '/')
  OR (new.hub_project_id IS NULL AND substr(new.id, 1, 4) <> '@rh/')
) BEGIN
  INSERT INTO passage_queue (project_id, paper_id, next_at, enqueued_at)
  VALUES (
    coalesce(new.hub_project_id, 'lab'),
    CASE WHEN new.hub_project_id IS NULL THEN new.id ELSE substr(new.id, length(new.hub_project_id) + 6) END,
    new.updated_at,
    new.updated_at
  )
  ON CONFLICT (project_id, paper_id) DO UPDATE SET status = 'pending', generation = generation + 1,
    attempts = 0, next_at = excluded.next_at, enqueued_at = excluded.enqueued_at, last_error = NULL;
END;
CREATE TRIGGER passage_enqueue_update AFTER UPDATE OF version ON doc
WHEN new.collection = 'papers' AND new.version IS NOT old.version AND (
  (new.hub_project_id IS NOT NULL
    AND substr(new.id, 1, length(new.hub_project_id) + 5) = '@rh/' || new.hub_project_id || '/')
  OR (new.hub_project_id IS NULL AND substr(new.id, 1, 4) <> '@rh/')
) BEGIN
  INSERT INTO passage_queue (project_id, paper_id, next_at, enqueued_at)
  VALUES (
    coalesce(new.hub_project_id, 'lab'),
    CASE WHEN new.hub_project_id IS NULL THEN new.id ELSE substr(new.id, length(new.hub_project_id) + 6) END,
    new.updated_at,
    new.updated_at
  )
  ON CONFLICT (project_id, paper_id) DO UPDATE SET status = 'pending', generation = generation + 1,
    attempts = 0, next_at = excluded.next_at, enqueued_at = excluded.enqueued_at, last_error = NULL;
END;
