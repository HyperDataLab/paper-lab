-- Keep ordered lists and cursor reads on the document's own timestamps and index fields.
CREATE INDEX doc_body_updated ON doc (collection, COALESCE(json_extract(summary_json, '$.updatedAt'), updated_at), id)
  WHERE deleted_at IS NULL;
CREATE INDEX doc_body_created ON doc (collection, COALESCE(json_extract(summary_json, '$.createdAt'), created_at), id)
  WHERE deleted_at IS NULL;
CREATE INDEX doc_audit_at ON doc (collection, COALESCE(json_extract(summary_json, '$.at'), ''), id)
  WHERE deleted_at IS NULL;
CREATE INDEX doc_topic_id ON doc (collection, COALESCE(json_extract(summary_json, '$.topicId'), -1), id)
  WHERE deleted_at IS NULL;
