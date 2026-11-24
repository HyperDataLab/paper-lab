import { KG_SQL_MAX_BYTES, KgSqlRequestSchema, type KgSqlResult } from '../../../src/core/schemas/kgSql';
import { KG_TABLE_CONCEPTS } from '../../../src/core/semantic/kgSchema';
import { publishedError } from '../published';
import { D1_MAX_COMPOUND_SELECT, type D1Database } from './bindings';
import { identifier, invalidSql, isSymbol, KgSqlError, tokenizeSql, word, type Token } from './sqlTokens';

const CONCEPT_IDS = new Map(KG_TABLE_CONCEPTS.map(({ id, store }) => [store.table, id]));
const COMPOUND = new Set(['union', 'intersect', 'except']);
const FROM_END = new Set(['where', 'having', 'limit']);
const SQL_TIME_BUDGET_MS = 5_000;
const MAX_BODY_BYTES = KG_SQL_MAX_BYTES * 6 + 1_024; // A JSON escape can take six bytes per character.
const wrapSql = (sql: string) => `SELECT * FROM (${sql}) LIMIT ?`;
const PROJECT_SCOPE_COLUMN: Record<string, string> = {
  paper: 'id',
  source: 'id',
  keyword: 'id',
  author: 'id',
  institution: 'id',
  topic: 'id',
  subfield: 'id',
  field: 'id',
  domain: 'id',
  contribution: 'published_paper_id',
  builds_on: 'published_paper_id',
  has_keyword: 'paper_id',
  cites: 'paper_id',
  related_to: 'paper_id',
  authored: 'paper_id',
  affiliated: 'paper_id',
  has_topic: 'paper_id',
  coauthor: 'left_id',
  cooccur: 'left_id',
  subfield_of: 'topic_id',
  field_of: 'subfield_id',
  domain_of: 'field_id',
};

function render(tokens: Token[]): string {
  let sql = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.kind === 'group') {
      if (sql && !sql.endsWith(' ') && !sql.endsWith('(')) sql += ' ';
      sql += `(${render(token.tokens)})`;
      continue;
    }
    if (token.kind === 'symbol' && token.value === '.') {
      sql = `${sql.trimEnd()}.`;
      continue;
    }
    if (token.kind === 'symbol' && token.value === ',') {
      sql = `${sql.trimEnd()}, `;
      continue;
    }
    const next = tokens[i + 1];
    const operator = token.kind === 'symbol' && next?.kind === 'symbol' ? `${token.value}${next.value}` : '';
    if (['!=', '<>', '<=', '>=', '||', '=='].includes(operator)) {
      if (sql && !sql.endsWith(' ')) sql += ' ';
      sql += `${operator} `;
      i++;
      continue;
    }
    if (sql && !sql.endsWith(' ') && !sql.endsWith('.')) sql += ' ';
    if (token.kind === 'string') sql += `'${token.value.replaceAll("'", "''")}'`;
    else if (token.kind === 'identifier') sql += `"${token.value.replaceAll('"', '""')}"`;
    else sql += token.value;
  }
  return sql.trim();
}

type Scope = ReadonlySet<string>;

class SqlSources {
  readonly concepts = new Set<string>();

  constructor(private readonly projectId?: string) {}

  query(tokens: Token[], inherited: Scope) {
    let start = 0;
    const ctes = new Set(inherited);
    if (word(tokens[start]) === 'with') {
      if (word(tokens[++start]) === 'recursive') invalidSql('Recursive CTEs are not allowed.');
      for (;;) {
        const name = identifier(tokens[start++]);
        if (!name || this.reserved(name) || CONCEPT_IDS.has(name) || ctes.has(name))
          invalidSql('CTE names must be distinct and must not shadow tables or other CTEs.');
        const columns = tokens[start];
        if (columns?.kind === 'group') {
          if (
            !columns.tokens.length ||
            columns.tokens.some((token, index) => (index % 2 ? !isSymbol(token, ',') : !identifier(token))) ||
            isSymbol(columns.tokens.at(-1), ',')
          )
            invalidSql('Invalid CTE column list.');
          start++;
        }
        if (word(tokens[start++]) !== 'as') invalidSql('A CTE must use AS (SELECT …).');
        if (word(tokens[start]) === 'not' && word(tokens[++start]) !== 'materialized')
          invalidSql('Expected NOT MATERIALIZED.');
        if (word(tokens[start]) === 'materialized') start++;
        const body = tokens[start++];
        if (body?.kind !== 'group') invalidSql('A CTE must contain a SELECT.');
        // Validate before adding the name to exclude implicit recursion and forward references.
        this.query(body.tokens, ctes);
        ctes.add(name);
        if (!isSymbol(tokens[start], ',')) break;
        start++;
      }
    }
    if (word(tokens[start]) !== 'select')
      throw new KgSqlError('sql_select_required', 'Use SELECT or WITH … SELECT.');
    this.scan(tokens, start + 1, ctes, false);
  }

  private scan(tokens: Token[], start: number, ctes: Scope, inFrom: boolean) {
    let terms = 1;
    for (let i = start; i < tokens.length; i++) {
      const token = tokens[i];
      const keyword = word(token);
      if (keyword && COMPOUND.has(keyword)) {
        if (++terms > D1_MAX_COMPOUND_SELECT)
          throw new KgSqlError('sql_limit', 'D1 supports five terms per compound SELECT.');
        inFrom = false;
      } else if (
        keyword &&
        (FROM_END.has(keyword) ||
          ((keyword === 'group' || keyword === 'order') && word(tokens[i + 1]) === 'by') ||
          (keyword === 'window' && identifier(tokens[i + 1]) && word(tokens[i + 2]) === 'as'))
      ) {
        inFrom = false;
      } else if (
        (keyword === 'from' &&
          !(
            word(tokens[i - 1]) === 'distinct' &&
            (word(tokens[i - 2]) === 'is' || (word(tokens[i - 2]) === 'not' && word(tokens[i - 3]) === 'is'))
          )) ||
        keyword === 'join' ||
        (inFrom && isSymbol(token, ','))
      ) {
        this.source(tokens, ++i, ctes);
        inFrom = true;
      } else {
        this.expression(tokens, i, ctes);
      }
    }
  }

  private reserved(name: string) {
    return (
      name.startsWith('sqlite_') ||
      name === 'doc' ||
      name.startsWith('doc_') ||
      /^(?:paper|keyword)_fts(?:_|$)/u.test(name)
    );
  }

  private source(tokens: Token[], index: number, ctes: Scope) {
    const token = tokens[index];
    if (token?.kind === 'group') {
      const first = word(token.tokens[0]);
      if (first === 'select' || first === 'with') {
        this.query(token.tokens, ctes);
      } else {
        this.source(token.tokens, 0, ctes);
        this.scan(token.tokens, 1, ctes, true);
      }
      return;
    }
    const name = identifier(token);
    if (!name || isSymbol(tokens[index + 1], '.') || tokens[index + 1]?.kind === 'group')
      throw new KgSqlError('sql_table', 'Use an unqualified KG table, a CTE, or a SELECT subquery.');
    if (ctes.has(name)) return;
    const concept = !this.reserved(name) && CONCEPT_IDS.get(name);
    if (!concept)
      throw new KgSqlError('sql_table', 'The statement references a table outside the KG registry.');
    this.concepts.add(concept);
    if (this.projectId) {
      const scopeColumn = PROJECT_SCOPE_COLUMN[name];
      if (!scopeColumn) throw new KgSqlError('sql_table', 'The KG table has no project scope.');
      const prefix = `@rh/${this.projectId}/%`;
      tokens[index] = {
        kind: 'group',
        tokens: [
          { kind: 'word', value: 'select' },
          { kind: 'symbol', value: '*' },
          { kind: 'word', value: 'from' },
          { kind: 'identifier', value: name },
          { kind: 'word', value: 'where' },
          { kind: 'identifier', value: scopeColumn },
          { kind: 'word', value: 'like' },
          { kind: 'string', value: prefix },
        ],
      };
      const next = tokens[index + 1];
      const nextWord = word(next);
      const clause = new Set([
        'where',
        'join',
        'left',
        'right',
        'full',
        'inner',
        'cross',
        'outer',
        'on',
        'using',
        'group',
        'order',
        'limit',
        'union',
        'intersect',
        'except',
        'window',
        'having',
        'indexed',
      ]);
      const hasAlias =
        nextWord === 'as' ||
        (next && (next.kind === 'word' || next.kind === 'identifier') && !clause.has(nextWord ?? ''));
      if (!hasAlias)
        tokens.splice(index + 1, 0, { kind: 'word', value: 'as' }, { kind: 'identifier', value: name });
    }
  }

  private expression(tokens: Token[], index: number, ctes: Scope) {
    const token = tokens[index];
    const next = tokens[index + 1];
    // SQLite also accepts `x IN table` and `x IN table_function(...)` as implicit reads.
    if (word(token) === 'in' && next?.kind !== 'group') invalidSql('Use IN (...) for values and subqueries.');
    if (token?.kind === 'string' && token.value.toLowerCase() === 'load_extension' && next?.kind === 'group')
      throw new KgSqlError('sql_forbidden', 'SQL contains a prohibited function.');
    if (token?.kind !== 'group') return;
    if (word(token.tokens[0]) === 'select' || word(token.tokens[0]) === 'with') {
      this.query(token.tokens, ctes);
    } else {
      token.tokens.forEach((_, i) => this.expression(token.tokens, i, ctes));
    }
  }
}

export function validateKgSql(input: string, projectId?: string) {
  if (
    input.length > KG_SQL_MAX_BYTES ||
    new TextEncoder().encode(wrapSql(input)).byteLength > KG_SQL_MAX_BYTES
  )
    throw new KgSqlError('sql_limit', 'The wrapped SQL exceeds the D1 statement size limit.');
  const sql = input.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/gu, '');
  const { tokens, terminated } = tokenizeSql(sql);
  const sources = new SqlSources(projectId);
  sources.query(tokens, new Set());
  return {
    sql: terminated ? sql.slice(0, -1).trimEnd() : sql,
    ...(projectId ? { scopedSql: render(tokens) } : {}),
    concepts: [...sources.concepts],
  };
}

type DbCell = KgSqlResult['rows'][number][number];

export async function runKgSql(db: D1Database, input: unknown, projectId?: string): Promise<KgSqlResult> {
  const parsed = KgSqlRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new KgSqlError('bad_request', 'Expected SQL and an optional integer limit from 1 to 1000.');
  const validated = validateKgSql(parsed.data.sql, projectId);
  const { sql, concepts } = validated;
  const executableSql = validated.scopedSql ?? sql;
  const { limit } = parsed.data;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [columns = [], ...rows] = await Promise.race([
      // D1 has no cancellation API. This deadline bounds the wait; D1 bounds execution independently.
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new KgSqlError('sql_timeout', 'The KG query exceeded its time budget.')),
          SQL_TIME_BUDGET_MS,
        );
      }),
      db
        .prepare(wrapSql(executableSql))
        .bind(limit + 1)
        .raw<DbCell[]>({ columnNames: true }),
    ]);
    return {
      sql,
      columns,
      rows: rows.slice(0, limit),
      truncated: rows.length > limit,
      concepts,
    };
  } catch (cause) {
    if (cause instanceof KgSqlError) throw cause;
    const message = cause instanceof Error ? cause.message : '';
    if (/timeout|timed out|interrupt|maximum.*duration/iu.test(message))
      throw new KgSqlError('sql_timeout', 'D1 stopped the query after its execution deadline.');
    if (/too (?:many|large|long)|limit|pattern too complex/iu.test(message))
      throw new KgSqlError('sql_limit', 'The query exceeded a D1 limit.');
    throw new KgSqlError(
      'sql_execution',
      'D1 could not execute the SELECT. Check its syntax and column names.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function handleKgSql(
  db: D1Database,
  request: Request,
  headers: Record<string, string>,
  projectId: string,
) {
  const responseHeaders = { ...headers, 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') return publishedError(405, 'bad_request', 'Use POST.', responseHeaders);
  try {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
      throw new KgSqlError('sql_limit', 'The SQL request body is too large.');
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new KgSqlError('sql_limit', 'The SQL request body is too large.');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new KgSqlError('bad_request', 'Expected a JSON request body.');
    }
    return Response.json(await runKgSql(db, body, projectId), { headers: responseHeaders });
  } catch (cause) {
    if (cause instanceof KgSqlError) return publishedError(400, cause.code, cause.message, responseHeaders);
    throw cause;
  }
}
