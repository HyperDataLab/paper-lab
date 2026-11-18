CREATE TABLE source (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE domain (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE field (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE subfield (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE topic (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE paper (
  id TEXT PRIMARY KEY,
  doi TEXT,
  title TEXT NOT NULL,
  title_normalized TEXT NOT NULL,
  abstract TEXT,
  publication_year INTEGER,
  cited_by_count INTEGER,
  type TEXT,
  source_id TEXT REFERENCES source(id),
  subfield_id TEXT REFERENCES subfield(id)
);
CREATE TABLE keyword (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 0 CHECK (frequency >= 0)
);
CREATE TABLE author (id TEXT PRIMARY KEY, display_name TEXT, orcid TEXT);
CREATE TABLE institution (id TEXT PRIMARY KEY, display_name TEXT, ror TEXT, country_code TEXT);

CREATE INDEX paper_doi_idx ON paper(doi);
CREATE INDEX paper_title_normalized_idx ON paper(title_normalized);
CREATE INDEX paper_year_idx ON paper(publication_year);
CREATE INDEX paper_source_idx ON paper(source_id);
CREATE INDEX paper_subfield_idx ON paper(subfield_id);
CREATE INDEX keyword_normalized_idx ON keyword(text_normalized);

CREATE TABLE has_keyword (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  keyword_id TEXT NOT NULL REFERENCES keyword(id),
  relevance_score REAL NOT NULL,
  PRIMARY KEY (paper_id, keyword_id)
) WITHOUT ROWID;
-- Citation and related-work destinations may be outside the ingested graph.
CREATE TABLE cites (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  target_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, target_id)
) WITHOUT ROWID;
CREATE TABLE related_to (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  target_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, target_id)
) WITHOUT ROWID;
CREATE TABLE authored (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  author_id TEXT NOT NULL REFERENCES author(id),
  position INTEGER NOT NULL CHECK (position > 0),
  PRIMARY KEY (paper_id, author_id)
) WITHOUT ROWID;
-- Affiliations belong to authorships, so different papers can record different institutions.
CREATE TABLE affiliated (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  author_id TEXT NOT NULL REFERENCES author(id),
  institution_id TEXT NOT NULL REFERENCES institution(id),
  PRIMARY KEY (paper_id, author_id, institution_id)
) WITHOUT ROWID;
CREATE TABLE coauthor (
  left_id TEXT NOT NULL REFERENCES author(id),
  right_id TEXT NOT NULL REFERENCES author(id),
  count INTEGER NOT NULL CHECK (count > 0),
  CHECK (left_id < right_id),
  PRIMARY KEY (left_id, right_id)
) WITHOUT ROWID;
CREATE TABLE cooccur (
  left_id TEXT NOT NULL REFERENCES keyword(id),
  right_id TEXT NOT NULL REFERENCES keyword(id),
  count INTEGER NOT NULL CHECK (count > 0),
  jaccard REAL NOT NULL,
  CHECK (left_id < right_id),
  PRIMARY KEY (left_id, right_id)
) WITHOUT ROWID;
CREATE TABLE has_topic (
  paper_id TEXT NOT NULL REFERENCES paper(id),
  topic_id TEXT NOT NULL REFERENCES topic(id),
  score REAL,
  PRIMARY KEY (paper_id, topic_id)
) WITHOUT ROWID;
CREATE TABLE subfield_of (
  topic_id TEXT NOT NULL PRIMARY KEY REFERENCES topic(id),
  subfield_id TEXT NOT NULL REFERENCES subfield(id)
) WITHOUT ROWID;
CREATE TABLE field_of (
  subfield_id TEXT NOT NULL PRIMARY KEY REFERENCES subfield(id),
  field_id TEXT NOT NULL REFERENCES field(id)
) WITHOUT ROWID;
CREATE TABLE domain_of (
  field_id TEXT NOT NULL PRIMARY KEY REFERENCES field(id),
  domain_id TEXT NOT NULL REFERENCES domain(id)
) WITHOUT ROWID;

CREATE INDEX has_keyword_reverse_idx ON has_keyword(keyword_id, paper_id);
CREATE INDEX cites_reverse_idx ON cites(target_id, paper_id);
CREATE INDEX related_to_reverse_idx ON related_to(target_id, paper_id);
CREATE INDEX authored_reverse_idx ON authored(author_id, paper_id);
CREATE INDEX affiliated_author_idx ON affiliated(author_id, institution_id);
CREATE INDEX affiliated_institution_idx ON affiliated(institution_id, author_id);
CREATE INDEX coauthor_reverse_idx ON coauthor(right_id, left_id);
CREATE INDEX cooccur_reverse_idx ON cooccur(right_id, left_id);
CREATE INDEX has_topic_reverse_idx ON has_topic(topic_id, paper_id);
CREATE INDEX subfield_of_reverse_idx ON subfield_of(subfield_id);
CREATE INDEX field_of_reverse_idx ON field_of(field_id);
CREATE INDEX domain_of_reverse_idx ON domain_of(domain_id);

CREATE TABLE contribution (
  id TEXT NOT NULL,
  published_paper_id TEXT NOT NULL,
  paper_doi TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  review TEXT NOT NULL CHECK (review IN ('candidate', 'accepted')),
  body TEXT NOT NULL,
  PRIMARY KEY (published_paper_id, id)
) WITHOUT ROWID;
CREATE INDEX contribution_doi_idx ON contribution(paper_doi);
CREATE INDEX contribution_id_idx ON contribution(id);

-- Targets can be unpublished contributions or external prerequisites, papers and tools.
CREATE TABLE builds_on (
  published_paper_id TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  prerequisite_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('prerequisite', 'contribution', 'paper', 'tool')),
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('prerequisite', 'reference', 'match')),
  review TEXT NOT NULL CHECK (review IN ('candidate', 'accepted')),
  PRIMARY KEY (published_paper_id, contribution_id, prerequisite_id, target_kind, target_id, relation),
  FOREIGN KEY (published_paper_id, contribution_id) REFERENCES contribution(published_paper_id, id)
) WITHOUT ROWID;
CREATE INDEX builds_on_reverse_idx ON builds_on(target_kind, target_id);

CREATE VIRTUAL TABLE paper_fts USING fts5(title, abstract, content='paper', content_rowid='rowid');
CREATE VIRTUAL TABLE keyword_fts USING fts5(text, content='keyword', content_rowid='rowid');

CREATE TRIGGER paper_fts_insert AFTER INSERT ON paper BEGIN
  INSERT INTO paper_fts(rowid, title, abstract) VALUES (new.rowid, new.title, new.abstract);
END;
CREATE TRIGGER paper_fts_delete AFTER DELETE ON paper BEGIN
  INSERT INTO paper_fts(paper_fts, rowid, title, abstract) VALUES ('delete', old.rowid, old.title, old.abstract);
END;
CREATE TRIGGER paper_fts_update AFTER UPDATE OF title, abstract ON paper
WHEN old.title IS NOT new.title OR old.abstract IS NOT new.abstract BEGIN
  INSERT INTO paper_fts(paper_fts, rowid, title, abstract) VALUES ('delete', old.rowid, old.title, old.abstract);
  INSERT INTO paper_fts(rowid, title, abstract) VALUES (new.rowid, new.title, new.abstract);
END;
CREATE TRIGGER keyword_fts_insert AFTER INSERT ON keyword BEGIN
  INSERT INTO keyword_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER keyword_fts_delete AFTER DELETE ON keyword BEGIN
  INSERT INTO keyword_fts(keyword_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER keyword_fts_update AFTER UPDATE OF text ON keyword WHEN old.text IS NOT new.text BEGIN
  INSERT INTO keyword_fts(keyword_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO keyword_fts(rowid, text) VALUES (new.rowid, new.text);
END;
