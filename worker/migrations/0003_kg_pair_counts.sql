-- Membership changes update pair counts in the same transaction as the paper's edges.
-- Scores and author order can change without changing membership.
CREATE TRIGGER authored_pair_insert AFTER INSERT ON authored BEGIN
  INSERT INTO coauthor(left_id, right_id, count)
    SELECT min(new.author_id, author_id), max(new.author_id, author_id), 1
    FROM authored WHERE paper_id = new.paper_id AND author_id <> new.author_id
    ON CONFLICT(left_id, right_id) DO UPDATE SET count = coauthor.count + 1;
END;
CREATE TRIGGER authored_pair_delete AFTER DELETE ON authored BEGIN
  DELETE FROM coauthor WHERE count = 1 AND (left_id, right_id) IN (
    SELECT min(old.author_id, author_id), max(old.author_id, author_id)
    FROM authored WHERE paper_id = old.paper_id
  );
  UPDATE coauthor SET count = count - 1 WHERE (left_id, right_id) IN (
    SELECT min(old.author_id, author_id), max(old.author_id, author_id)
    FROM authored WHERE paper_id = old.paper_id
  );
END;

CREATE TRIGGER keyword_pair_insert AFTER INSERT ON has_keyword BEGIN
  UPDATE keyword SET frequency = frequency + 1 WHERE id = new.keyword_id;
  INSERT INTO cooccur(left_id, right_id, count, jaccard)
    SELECT min(new.keyword_id, keyword_id), max(new.keyword_id, keyword_id), 1, 0
    FROM has_keyword WHERE paper_id = new.paper_id AND keyword_id <> new.keyword_id
    ON CONFLICT(left_id, right_id) DO UPDATE SET count = cooccur.count + 1;
  UPDATE cooccur SET jaccard = 1.0 * count / (
    (SELECT frequency FROM keyword WHERE id = left_id) +
    (SELECT frequency FROM keyword WHERE id = right_id) - count
  ) WHERE left_id = new.keyword_id OR right_id = new.keyword_id;
END;
CREATE TRIGGER keyword_pair_delete AFTER DELETE ON has_keyword BEGIN
  UPDATE keyword SET frequency = frequency - 1 WHERE id = old.keyword_id;
  DELETE FROM cooccur WHERE count = 1 AND (left_id, right_id) IN (
    SELECT min(old.keyword_id, keyword_id), max(old.keyword_id, keyword_id)
    FROM has_keyword WHERE paper_id = old.paper_id
  );
  UPDATE cooccur SET count = count - 1 WHERE (left_id, right_id) IN (
    SELECT min(old.keyword_id, keyword_id), max(old.keyword_id, keyword_id)
    FROM has_keyword WHERE paper_id = old.paper_id
  );
  UPDATE cooccur SET jaccard = 1.0 * count / (
    (SELECT frequency FROM keyword WHERE id = left_id) +
    (SELECT frequency FROM keyword WHERE id = right_id) - count
  ) WHERE left_id = old.keyword_id OR right_id = old.keyword_id;
END;
