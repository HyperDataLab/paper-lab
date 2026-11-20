import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from './bindings';
import { runKgSql, validateKgSql } from './sql';
import { testDb } from './testDb';

describe('semantic step 4 SQL validator', () => {
  it.each([
    ['multi-statement', 'SELECT 1; SELECT 2', 'sql_multiple_statements'],
    ['extra semicolon', 'SELECT 1;;', 'sql_multiple_statements'],
    ['line comment', 'SELECT 1 -- comment', 'sql_comment'],
    ['block comment', 'SELECT/* comment */ 1', 'sql_comment'],
    ['PRAGMA', 'PRAGMA table_list', 'sql_forbidden'],
    ['ATTACH', "ATTACH ':memory:' AS other", 'sql_forbidden'],
    ['write', "UPDATE paper SET title = 'changed'", 'sql_forbidden'],
    ['write after WITH', 'WITH p AS (SELECT id FROM paper) DELETE FROM paper', 'sql_forbidden'],
    ['sqlite_master', 'SELECT * FROM "sqLITE_master"', 'sql_table'],
    ['unknown table', 'SELECT * FROM unknown_table', 'sql_table'],
    ['doc', 'SELECT * FROM [doc]', 'sql_table'],
    ['FTS shadow table', 'SELECT * FROM `paper_fts_data`', 'sql_table'],
    ['RETURNING', 'SELECT returning FROM paper', 'sql_forbidden'],
    ['load_extension', "SELECT load_extension('synthetic')", 'sql_forbidden'],
    ['quoted load_extension', "SELECT `load_extension`('synthetic')", 'sql_forbidden'],
    ['nested forbidden source', 'SELECT exists(SELECT 1 FROM doc) FROM paper', 'sql_table'],
    ['comma join', 'SELECT * FROM paper p, doc', 'sql_table'],
    ['comma join after contextual alias', 'SELECT * FROM paper AS window, doc', 'sql_table'],
    ['parenthesized join', 'SELECT * FROM (paper JOIN doc)', 'sql_table'],
    ['implicit IN source', 'SELECT 1 WHERE (1 IN doc)', 'sql_invalid'],
    ['table-valued function', "SELECT * FROM json_each('[]')", 'sql_table'],
    ['schema-qualified source', 'SELECT * FROM temp.paper', 'sql_table'],
    ['single-quoted source', "SELECT * FROM 'doc'", 'sql_table'],
    ['reserved bind marker', 'SELECT ?1', 'sql_invalid'],
    ['implicit recursion', 'WITH c AS (SELECT 1 UNION ALL SELECT * FROM c) SELECT * FROM c', 'sql_table'],
    ['CTE shadowing', 'WITH paper AS (SELECT 1) SELECT * FROM paper', 'sql_invalid'],
    ['CTE with forbidden source', 'WITH c AS (SELECT * FROM doc) SELECT * FROM c', 'sql_table'],
    ['D1 compound SELECT limit', Array(6).fill('SELECT 1').join(' UNION ALL '), 'sql_limit'],
    ['D1 byte limit', `SELECT '${'ệ'.repeat(34_000)}'`, 'sql_limit'],
  ])('rejects %s', (_, input, code) => {
    expect(() => validateKgSql(input)).toThrow(expect.objectContaining({ code }));
  });

  it('accepts joins, quoted identifiers and a single trailing semicolon', () => {
    const sql =
      'SELECT p.title, a.display_name FROM ("Paper" p JOIN authored e ON p.id = e.paper_id) JOIN [author] a ON a.id = e.author_id';
    expect(validateKgSql(`\n${sql};  `)).toEqual({
      sql,
      concepts: ['kg-paper', 'kg-authored', 'kg-author'],
    });
  });

  it('accepts multiple CTEs with scoped names and gathers physical source concepts once', () => {
    const sql =
      'WITH recent(id) AS (SELECT id FROM paper), cited AS (SELECT * FROM cites WHERE paper_id IN (SELECT id FROM recent)) SELECT target_id FROM cited JOIN paper ON paper.id = cited.paper_id';
    expect(validateKgSql(sql)).toEqual({ sql, concepts: ['kg-paper', 'kg-cites'] });
  });

  it('treats comment markers, semicolons and keywords inside quoted strings as data', () => {
    const sql =
      "SELECT 'a''; -- PRAGMA /* DROP sqlite_master */' AS text FROM paper WHERE title IS DISTINCT FROM 'other'";
    expect(validateKgSql(sql)).toEqual({ sql, concepts: ['kg-paper'] });
  });
});

describe('semantic step 4 read-only D1 runner', () => {
  it('runs a CTE and join, caps rows, and keeps columns when no rows match', async () => {
    const { db, sqlite } = testDb();
    sqlite.exec(`
      INSERT INTO source (id, display_name) VALUES ('S1', 'Synthetic venue');
      INSERT INTO paper (id, title, title_normalized, source_id) VALUES
        ('W1', 'Synthetic first', 'synthetic first', 'S1'),
        ('W2', 'Synthetic second', 'synthetic second', NULL);
    `);
    const sql =
      'WITH works AS (SELECT id, title, source_id FROM paper) SELECT title, display_name AS venue FROM works LEFT JOIN source ON source.id = works.source_id';
    const capped = await runKgSql(db, { sql: `${sql} ORDER BY works.id;`, limit: 1 });
    expect(capped).toEqual({
      sql: `${sql} ORDER BY works.id`,
      columns: ['title', 'venue'],
      rows: [['Synthetic first', 'Synthetic venue']],
      truncated: true,
      concepts: ['kg-paper', 'kg-source'],
    });
    expect(await runKgSql(db, { sql: `${sql} ORDER BY works.id`, limit: 2 })).toMatchObject({
      rows: [
        ['Synthetic first', 'Synthetic venue'],
        ['Synthetic second', null],
      ],
      truncated: false,
    });
    expect(await runKgSql(db, { sql: `${sql} WHERE 0` })).toMatchObject({
      columns: ['title', 'venue'],
      rows: [],
      truncated: false,
    });
  });

  it('applies the default limit and rejects limits above 1000', async () => {
    const { db, sqlite } = testDb();
    const insert = sqlite.prepare('INSERT INTO source (id) VALUES (?)');
    for (let i = 0; i < 102; i++) insert.run(`S${i}`);
    const sql = 'SELECT id FROM source ORDER BY id';
    const result = await runKgSql(db, { sql });
    expect(result.rows).toHaveLength(100);
    expect(result.truncated).toBe(true);
    await expect(runKgSql(db, { sql, limit: 1_001 })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('returns a timeout error when D1 has not replied by the response deadline', async () => {
    vi.useFakeTimers();
    try {
      const statement = { bind: vi.fn(() => statement), raw: () => new Promise<never>(() => {}) };
      const db: D1Database = { prepare: vi.fn(() => statement), batch: vi.fn() };
      const expectTimeout = expect(runKgSql(db, { sql: 'SELECT id FROM paper' })).rejects.toMatchObject({
        code: 'sql_timeout',
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expectTimeout;
      expect(db.prepare).toHaveBeenCalledWith('SELECT * FROM (SELECT id FROM paper) LIMIT ?');
      expect(statement.bind).toHaveBeenCalledWith(101);
    } finally {
      vi.useRealTimers();
    }
  });
});
