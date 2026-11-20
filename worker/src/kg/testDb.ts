/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';
import type { D1Database, D1Statement, SqlValue } from './bindings';

class Statement implements D1Statement {
  constructor(
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}
  bind(...values: SqlValue[]) {
    return new Statement(this.sql, values);
  }
}

/** D1 allows at most five terms in a compound SELECT; SQLite's default is 500. */
export const D1_MAX_COMPOUND_SELECT = 5;
const compoundTerms = (sql: string) => (sql.match(/\b(?:UNION|INTERSECT|EXCEPT)\b/giu)?.length ?? 0) + 1;

/** An in-memory D1 with the migrations of `migrationsDir` (relative to worker/) applied. */
export function testDb(migrationsDir = 'migrations') {
  const sqlite = new DatabaseSync(':memory:');
  // `limits` exists from Node 24; the statement check below covers older runtimes.
  const limits = (sqlite as { limits?: { compoundSelect: number } }).limits;
  if (limits) limits.compoundSelect = D1_MAX_COMPOUND_SELECT;
  onTestFinished(() => sqlite.close());
  const migrations = resolve(dirname(fileURLToPath(import.meta.url)), '../../', migrationsDir);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve(migrations, file), 'utf8'));
  const db: D1Database = {
    prepare: (sql) => new Statement(sql),
    async batch<T>(statements: D1Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof Statement)) throw new Error('Expected a bound SQLite statement');
          if (statement.values.length > 100) throw new Error('D1 supports at most 100 bindings');
          if (compoundTerms(statement.sql) > D1_MAX_COMPOUND_SELECT)
            throw new Error('D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR');
          const prepared = sqlite.prepare(statement.sql);
          const rows = (
            /\?\d+/u.test(statement.sql)
              ? prepared.all(
                  Object.fromEntries(statement.values.map((value, index) => [`?${index + 1}`, value])),
                )
              : prepared.all(...statement.values)
          ) as T[];
          const changes = Number(sqlite.prepare('SELECT changes() AS count').get()?.count ?? 0);
          return { results: rows, meta: { changes } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, sqlite };
}
