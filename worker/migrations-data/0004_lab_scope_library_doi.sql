-- Lab scope (ADR 0008): one live lab library item per DOI again, as 0001 enforced before 0003 dropped the index.
-- Project rows keep their own per-project index from 0003.
CREATE UNIQUE INDEX doc_library_doi_lab
  ON doc (doi)
  WHERE collection = 'library' AND doi IS NOT NULL AND deleted_at IS NULL AND hub_project_id IS NULL;
