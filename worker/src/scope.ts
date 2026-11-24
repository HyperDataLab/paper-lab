/**
 * Data scope of one request (ADR 0008).
 *
 * - Lab scope (`projectId` null or undefined): the global lab store as it was before ResearchHub projects. Ids are
 *   unprefixed, D1 rows have `hub_project_id IS NULL`, R2 keys sit under `paperlab/<area>/`.
 * - Project scope (`projectId` a ResearchHub project id): ids are stored as `@rh/<projectId>/<id>`, D1 rows carry
 *   `hub_project_id`, R2 keys sit under `paperlab/projects/<projectId>/<area>/`.
 *
 * Neither scope ever sees the other's rows. A lab id may not start with `@rh/`, so a lab caller cannot name a
 * project row directly.
 */
import type { D1Database, D1Statement } from './kg/bindings';

export type ProjectScope = string | null | undefined;

export const PROJECT_ID_PREFIX = '@rh/';

/** True for an id that belongs to some project's physical namespace. */
export const isProjectPhysicalId = (id: string) => id.startsWith(PROJECT_ID_PREFIX);

/** `@rh/<projectId>/` in project scope, '' in lab scope. */
export const scopePrefix = (projectId: ProjectScope) =>
  projectId ? `${PROJECT_ID_PREFIX}${projectId}/` : '';

/** The stored id of a logical id in this scope. */
export const physicalId = (projectId: ProjectScope, id: string) => `${scopePrefix(projectId)}${id}`;

/** True when a stored id belongs to this scope. */
export const inScope = (projectId: ProjectScope, id: string) =>
  projectId ? id.startsWith(scopePrefix(projectId)) : !isProjectPhysicalId(id);

/** The logical id of a stored id in this scope. */
export const logicalId = (projectId: ProjectScope, id: string) => {
  const prefix = scopePrefix(projectId);
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
};

/**
 * A SQL predicate that keeps `column` (an id column) inside this scope. It always takes exactly one parameter,
 * `param` (`?` or `?N`), to be bound with `scopeBind(projectId)`, so positional parameters line up in both scopes.
 */
export const scopeSql = (projectId: ProjectScope, column: string, param = '?') =>
  projectId ? `${column} LIKE ${param}` : `(${column} NOT LIKE '${PROJECT_ID_PREFIX}%' AND ${param} IS NULL)`;

/** `scopeSql` with the scope inlined; `projectId` is a validated ResearchHub UUID, so it is safe as a literal. */
export const scopeSqlLiteral = (projectId: ProjectScope, column: string) =>
  projectId ? `${column} LIKE '${scopePrefix(projectId)}%'` : `${column} NOT LIKE '${PROJECT_ID_PREFIX}%'`;

/** The value bound to `scopeSql`'s parameter. */
export const scopeBind = (projectId: ProjectScope) => (projectId ? `${scopePrefix(projectId)}%` : null);

/**
 * Rewrites the `<column> LIKE ?` / `<column> LIKE ?N` scope predicates of a project-scope SQL text for this
 * scope. In project scope the text is returned unchanged; in lab scope each predicate becomes `scopeSql(null, …)`,
 * which keeps the parameter, so the statement binds `scopeBind(projectId)` in both scopes. Only use it on SQL whose
 * every `LIKE ?` is a scope predicate.
 */
export const scopeLikes = (projectId: ProjectScope, sql: string) =>
  projectId
    ? sql
    : sql.replace(/([A-Za-z_][\w.]*) LIKE (\?\d*)/gu, (_match, column: string, param: string) =>
        scopeSql(null, column, param),
      );

/** A KG database whose statements are rewritten with `scopeLikes` for this scope. */
export function scopedDb(db: D1Database, projectId: ProjectScope): D1Database {
  if (projectId) return db;
  return {
    prepare: (sql) => db.prepare(scopeLikes(projectId, sql)),
    batch: <T>(statements: D1Statement[]) => db.batch<T>(statements),
  };
}

/** R2 key prefix of a per-scope area such as `published` or `plans`. */
export const r2Prefix = (projectId: ProjectScope, area: string) =>
  projectId ? `paperlab/projects/${projectId}/${area}/` : `paperlab/${area}/`;
