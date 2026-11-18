/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

export function testDb() {
  const sqlite = new DatabaseSync(':memory:');
  onTestFinished(() => sqlite.close());
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const db: D1Database = {
    prepare: (sql) => new Statement(sql),
    async batch<T>(statements: D1Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof Statement)) throw new Error('Expected a bound SQLite statement');
          if (statement.values.length > 100) throw new Error('D1 supports at most 100 bindings');
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
