-- Keep the ResearchHub owner scope separate from the document's optional project_id index field.
ALTER TABLE doc ADD COLUMN hub_project_id TEXT;
CREATE INDEX doc_hub_project ON doc (hub_project_id, collection, updated_at);

DROP INDEX doc_library_doi;
CREATE UNIQUE INDEX doc_library_doi_project
  ON doc (hub_project_id, doi)
  WHERE collection = 'library' AND doi IS NOT NULL AND deleted_at IS NULL AND hub_project_id IS NOT NULL;
