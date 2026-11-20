export class KgSqlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Atom = { kind: 'word' | 'identifier' | 'string' | 'symbol'; value: string };
export type Token = Atom | { kind: 'group'; tokens: Token[] };

const FORBIDDEN = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'create',
  'drop',
  'alter',
  'attach',
  'detach',
  'pragma',
  'vacuum',
  'reindex',
  'analyze',
  'returning',
]);
const MAX_DEPTH = 24;
const MAX_TOKENS = 4_096;
const fold = (text: string) => text.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());

export const word = (token: Token | undefined) => (token?.kind === 'word' ? token.value : undefined);
export const identifier = (token: Token | undefined) =>
  token?.kind === 'identifier' || token?.kind === 'word' ? token.value : undefined;
export const isSymbol = (token: Token | undefined, value: string) =>
  token?.kind === 'symbol' && token.value === value;

export function invalidSql(message: string): never {
  throw new KgSqlError('sql_invalid', message);
}

function unquote(text: string) {
  const inner = text.slice(1, -1);
  return text.startsWith('[') ? inner : inner.replaceAll(text.slice(0, 1).repeat(2), text.slice(0, 1));
}

/** Read quotes and comments before punctuation so only real SQL syntax reaches the validator. */
export function tokenizeSql(sql: string) {
  const lexeme =
    /(?<space>[ \t\r\n\f]+)|(?<comment>--|\/\*)|(?<word>[A-Za-z_][A-Za-z_0-9$]*)|(?<string>'(?:[^']|'')*')|(?<identifier>"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\])|(?<symbol>[0-9]+|[(),.;~!<>=+*/%&|?-])/guy;
  const stack: Token[][] = [[]];
  let tokens = stack[0] as Token[];
  let count = 0;
  let terminated = false;
  if (sql.includes('\0')) invalidSql('NUL characters are not allowed in SQL.');

  while (lexeme.lastIndex < sql.length) {
    const match = lexeme.exec(sql);
    if (!match?.groups) invalidSql('Unsupported SQL token. Use ASCII identifiers or quote them.');
    const { space, comment, word: bare, string, identifier: quoted } = match.groups;
    const value = match[0];
    if (comment) throw new KgSqlError('sql_comment', 'SQL comments are not allowed.');
    if (space) continue;
    if (terminated || (value === ';' && stack.length !== 1))
      throw new KgSqlError('sql_multiple_statements', 'Submit one SQL statement.');
    if (++count > MAX_TOKENS) throw new KgSqlError('sql_limit', 'The SQL statement has too many tokens.');

    if (value === ';') {
      terminated = true;
    } else if (value === '(') {
      if (stack.length > MAX_DEPTH)
        throw new KgSqlError('sql_limit', 'The SQL statement is nested too deeply.');
      const group: Token[] = [];
      tokens.push({ kind: 'group', tokens: group });
      stack.push(group);
      tokens = group;
    } else if (value === ')') {
      stack.pop();
      const parent = stack.at(-1);
      if (!parent) invalidSql('Unbalanced SQL parentheses.');
      tokens = parent;
    } else {
      const name = bare ? fold(bare) : quoted ? fold(unquote(quoted)) : undefined;
      if (name === 'load_extension' || (bare && name && FORBIDDEN.has(name)))
        throw new KgSqlError('sql_forbidden', 'SQL contains a prohibited keyword or function.');
      if (value === '?') invalidSql('SQL parameters are reserved for the server.');
      tokens.push(
        bare
          ? { kind: 'word', value: name ?? bare }
          : quoted
            ? { kind: 'identifier', value: name ?? quoted }
            : string
              ? { kind: 'string', value: fold(unquote(string)) }
              : { kind: 'symbol', value },
      );
    }
  }
  if (stack.length !== 1) invalidSql('Unbalanced SQL parentheses.');
  return { tokens, terminated };
}
