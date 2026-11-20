import {
  COLLECTIONS,
  docSummary,
  type CollectionDef,
  type CollectionName,
  type DocIndex,
  type DocIndexField,
} from '../../../src/core/storage/collections';
import type { Bucket } from '../deps';
import type { D1Database, D1Statement, SqlValue } from '../kg/bindings';
import { INDEX_COLUMN } from './indexColumns';
import { queryPlan, type QueryGuard } from './queryPlan';

/** Every row is stamped with the lab so permissions (C5) can filter on it later. */
export const LAB_ID = 'hyperdatalab';
export const DATA_PREFIX = 'paperlab/data/';
/** D1 binds at most 100 parameters per statement. */
const MAX_PARAMS = 100;

export interface DocRow {
  collection: string;
  id: string;
  version: number;
  r2_key: string | null;
  body_json: string | null;
  size: number;
  sha256: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  deleted_at: string | null;
  lab_id: string;
  visibility: string;
  project_id: string | null;
  corpus_id: string | null;
  paper_id: string | null;
  ref_id: string | null;
  doi: string | null;
  title: string | null;
  kind: string | null;
  status: string | null;
  source_sha256: string | null;
  summary_json: string;
}

const INDEX_FIELDS = Object.keys(INDEX_COLUMN) as DocIndexField[];

export const etagOf = (version: number) => `"v${version}"`;
export const parseEtag = (value: string | null) => {
  const match = /^"v([1-9]\d{0,14})"$/u.exec(value?.trim() ?? '');
  return match ? Number(match[1]) : null;
};

export function bodyKey(collection: string, id: string, version: number, suffix?: string) {
  return `${DATA_PREFIX}${collection}/${encodeURIComponent(id)}/v${version}${suffix ? `-${suffix}` : ''}.json`;
}
/** Inverse of `bodyKey`; null for keys this store did not write. */
export function parseBodyKey(key: string) {
  const match = /^paperlab\/data\/([A-Za-z]+)\/([^/]+)\/v(\d+)(?:-[0-9a-f-]+)?\.json$/u.exec(key);
  if (!match) return null;
  try {
    return {
      collection: match[1] as string,
      id: decodeURIComponent(match[2] as string),
      version: Number(match[3]),
    };
  } catch {
    return null;
  }
}

export const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Current rows of `ids` in `collections`, deleted ones included, read in one batch. */
export async function readRows(db: D1Database, refs: { collection: string; id: string }[]) {
  const byCollection = new Map<string, Set<string>>();
  for (const ref of refs)
    byCollection.set(ref.collection, (byCollection.get(ref.collection) ?? new Set()).add(ref.id));
  const statements: D1Statement[] = [];
  for (const [collection, ids] of byCollection)
    for (const part of chunk([...ids], MAX_PARAMS - 1))
      statements.push(
        db
          .prepare(`SELECT * FROM doc WHERE collection = ? AND id IN (${part.map(() => '?').join(', ')})`)
          .bind(collection, ...part),
      );
  const rows = new Map<string, DocRow>();
  if (!statements.length) return rows;
  for (const result of await db.batch<DocRow>(statements))
    for (const row of result.results) rows.set(refKey(row), row);
  return rows;
}
export const refKey = (ref: { collection: string; id: string }) => `${ref.collection}\u0000${ref.id}`;
const liveVersion = (row: DocRow | undefined) => (row && !row.deleted_at ? row.version : null);

export type ValidationFailure = { error: 'invalid_body' | 'id_mismatch' | 'too_large'; message: string };

/** Validates one body against its collection; returns the index projection and summary. */
export function validateBody(
  collection: CollectionName,
  id: string,
  text: string,
):
  | { ok: true; def: CollectionDef; bytes: Uint8Array<ArrayBuffer>; index: DocIndex; summary: string }
  | ({ ok: false } & ValidationFailure) {
  const def = COLLECTIONS[collection] as CollectionDef;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > def.maxBytes)
    return { ok: false, error: 'too_large', message: `${collection}/${id} exceeds ${def.maxBytes} bytes.` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_body', message: `${collection}/${id} is not JSON.` };
  }
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: 'invalid_body',
      message: `${collection}/${id} does not match its schema at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? ''}`,
    };
  }
  if (def.key(parsed.data) !== id)
    return { ok: false, error: 'id_mismatch', message: `The body of ${collection}/${id} has another id.` };
  return {
    ok: true,
    def,
    bytes,
    index: def.index(parsed.data),
    summary: JSON.stringify(docSummary(def, value)),
  };
}

export interface CommitOp {
  collection: CollectionName;
  id: string;
  /** The live version the caller read, or null to create (no record, or a deleted one). */
  expectedVersion: number | null;
  op: 'put' | 'delete';
  /** The JSON body as text, for puts. */
  text?: string;
}
export interface CommitGuard {
  collection: CollectionName;
  id: string;
  expectedVersion: number | null;
}
/** Append-only inline rows (e.g. audit events); an id that exists already is skipped. */
export interface CommitAppend {
  collection: CollectionName;
  id: string;
  text: string;
}
export interface Conflict {
  collection: string;
  id: string;
  expectedVersion: number | null;
  serverVersion: number | null;
}
export type CommitResult =
  | { ok: true; results: { collection: string; id: string; version: number }[]; appended: number }
  | { ok: false; status: 400 | 413; error: string; message: string }
  | { ok: false; status: 409; error: 'version_conflict'; conflicts: Conflict[] }
  | { ok: false; status: 409; error: 'unique_conflict'; message: string };

export interface StoreEnv {
  db: D1Database;
  bucket: Bucket;
  now: () => Date;
  email: string;
}

/** The statement a version guard runs: it inserts a 0, which the CHECK rejects, when the doc changed. */
function guardStatement(db: D1Database, collection: string, id: string, prior: DocRow | undefined) {
  return prior
    ? db
        .prepare(
          'INSERT INTO version_guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM doc WHERE collection = ? AND id = ? AND version = ?)',
        )
        .bind(collection, id, prior.version)
    : db
        .prepare(
          'INSERT INTO version_guard (ok) SELECT 0 WHERE EXISTS (SELECT 1 FROM doc WHERE collection = ? AND id = ?)',
        )
        .bind(collection, id);
}

const DOC_COLUMNS = [
  'collection',
  'id',
  'version',
  'r2_key',
  'body_json',
  'size',
  'sha256',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'deleted_at',
  'lab_id',
  'visibility',
  ...INDEX_FIELDS.map((field) => INDEX_COLUMN[field]),
  'summary_json',
] as const;
const MUTABLE_COLUMNS = DOC_COLUMNS.filter(
  (column) => !['collection', 'id', 'lab_id', 'visibility'].includes(column),
);

/**
 * Applies a set of writes atomically. Bodies go to R2 first (new immutable keys), then one D1 batch runs a
 * version guard per touched record before any write. A guard that finds another version makes its
 * statement fail on the `version_conflict` CHECK, and D1 rolls the whole batch back (batches are
 * transactions), so either every write lands or none does.
 */
export async function commit(
  env: StoreEnv,
  ops: CommitOp[],
  guards: CommitGuard[] = [],
  appends: CommitAppend[] = [],
  queryGuards: QueryGuard[] = [],
): Promise<CommitResult> {
  const seen = new Set<string>();
  for (const ref of [...ops, ...guards, ...appends]) {
    if (seen.has(refKey(ref)))
      return {
        ok: false,
        status: 400,
        error: 'bad_request',
        message: `${ref.collection}/${ref.id} appears twice.`,
      };
    seen.add(refKey(ref));
  }
  const prepared = [];
  for (const op of ops) {
    if (op.op === 'delete') {
      if (op.expectedVersion === null)
        return {
          ok: false,
          status: 400,
          error: 'bad_request',
          message: 'A delete needs the expected version.',
        };
      prepared.push({ op, check: null });
      continue;
    }
    const check = validateBody(op.collection, op.id, op.text ?? '');
    if (!check.ok)
      return {
        ok: false,
        status: check.error === 'too_large' ? 413 : 400,
        error: check.error,
        message: check.message,
      };
    prepared.push({ op, check });
  }
  const appendChecks = [];
  for (const append of appends) {
    const check = validateBody(append.collection, append.id, append.text);
    if (!check.ok)
      return {
        ok: false,
        status: check.error === 'too_large' ? 413 : 400,
        error: check.error,
        message: check.message,
      };
    if (check.def.storage !== 'inline')
      return {
        ok: false,
        status: 400,
        error: 'bad_request',
        message: `${append.collection} is not an inline collection.`,
      };
    appendChecks.push({ append, check });
  }

  const rows = await readRows(env.db, [...ops, ...guards, ...appends]);
  const conflicts: Conflict[] = [];
  for (const ref of [...ops, ...guards]) {
    const serverVersion = liveVersion(rows.get(refKey(ref)));
    if (serverVersion !== ref.expectedVersion)
      conflicts.push({
        collection: ref.collection,
        id: ref.id,
        expectedVersion: ref.expectedVersion,
        serverVersion,
      });
  }
  if (conflicts.length) return { ok: false, status: 409, error: 'version_conflict', conflicts };

  const at = env.now().toISOString();
  // Bodies this commit uploaded. They are removed only when the batch certainly did not apply.
  const owned: string[] = [];
  const writes = await Promise.all(
    prepared.map(async ({ op, check }) => {
      const prior = rows.get(refKey(op));
      const version = (prior?.version ?? 0) + 1;
      if (!check) return { op, prior, version, values: null };
      const sha256 = await sha256Hex(check.bytes);
      let r2Key: string | null = null;
      if (check.def.storage === 'r2') {
        r2Key = await putBody(env, op, version, check.bytes, sha256, owned);
      }
      const live = prior && !prior.deleted_at;
      const values: Record<(typeof DOC_COLUMNS)[number], SqlValue> = {
        collection: op.collection,
        id: op.id,
        version,
        r2_key: r2Key,
        body_json: r2Key ? null : (op.text as string),
        size: check.bytes.byteLength,
        sha256,
        created_by: live ? prior.created_by : env.email,
        created_at: live ? prior.created_at : at,
        updated_by: env.email,
        updated_at: at,
        deleted_at: null,
        lab_id: LAB_ID,
        visibility: 'lab',
        ...indexValues(check.index),
        summary_json: check.summary,
      };
      return { op, prior, version, values };
    }),
  ).catch(async (error: unknown) => {
    await removeBodies(env.bucket, owned);
    throw error;
  });

  const { db } = env;
  const statements: D1Statement[] = [];
  for (const write of writes)
    statements.push(guardStatement(db, write.op.collection, write.op.id, write.prior));
  for (const guard of guards)
    statements.push(guardStatement(db, guard.collection, guard.id, rows.get(refKey(guard))));
  for (const guard of queryGuards) {
    const { conditions, values, ordering } = queryPlan(guard);
    // Compare inside the committing batch, including rows inserted after the client's query.
    statements.push(
      db
        .prepare(
          `INSERT INTO version_guard (ok)
        SELECT 0 WHERE (SELECT json_group_array(json_array(id, version)) FROM
          (SELECT id, version FROM doc WHERE ${conditions.join(' AND ')} ORDER BY ${ordering} LIMIT ?))
          <> json(?)`,
        )
        .bind(...values, guard.limit ?? -1, JSON.stringify(guard.rows)),
    );
  }
  for (const write of writes) {
    if (!write.values) {
      statements.push(
        db
          .prepare(
            'UPDATE doc SET version = ?, deleted_at = ?, updated_by = ?, updated_at = ?, r2_key = NULL, body_json = NULL WHERE collection = ? AND id = ? AND version = ?',
          )
          .bind(write.version, at, env.email, at, write.op.collection, write.op.id, write.version - 1),
      );
    } else if (write.prior) {
      statements.push(
        db
          .prepare(
            `UPDATE doc SET ${MUTABLE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE collection = ? AND id = ? AND version = ?`,
          )
          .bind(
            ...MUTABLE_COLUMNS.map((column) => write.values[column]),
            write.op.collection,
            write.op.id,
            write.prior.version,
          ),
      );
    } else {
      statements.push(insertDoc(db, write.values, ''));
    }
  }
  const fresh = appendChecks.filter(({ append }) => !rows.has(refKey(append)));
  for (const { append, check } of fresh)
    statements.push(
      insertDoc(
        db,
        {
          collection: append.collection,
          id: append.id,
          version: 1,
          r2_key: null,
          body_json: append.text,
          size: check.bytes.byteLength,
          sha256: await sha256Hex(check.bytes),
          created_by: env.email,
          created_at: at,
          updated_by: env.email,
          updated_at: at,
          deleted_at: null,
          lab_id: LAB_ID,
          visibility: 'lab',
          ...indexValues(check.index),
          summary_json: check.summary,
        },
        ' ON CONFLICT (collection, id) DO NOTHING',
      ),
    );
  const log = [
    ...writes.map((write) => [write.op.collection, write.op.id, write.version, write.op.op, env.email, at]),
    ...fresh.map(({ append }) => [append.collection, append.id, 1, 'put', env.email, at]),
  ];
  for (const part of chunk(log, Math.floor(MAX_PARAMS / 6)))
    statements.push(
      db
        .prepare(
          `INSERT INTO change_log (collection, id, version, op, actor, at) VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(...part.flat()),
    );

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/version_conflict|UNIQUE constraint failed: doc\.collection, doc\.id/u.test(message)) {
      await removeBodies(env.bucket, owned);
      const now = await readRows(db, [...ops, ...guards]);
      return {
        ok: false,
        status: 409,
        error: 'version_conflict',
        conflicts: [...ops, ...guards]
          .map((ref) => ({
            collection: ref.collection,
            id: ref.id,
            expectedVersion: ref.expectedVersion,
            serverVersion: liveVersion(now.get(refKey(ref))),
          }))
          .filter((conflict) => conflict.serverVersion !== conflict.expectedVersion)
          .concat(
            queryGuards.map(({ collection }) => ({
              collection,
              id: '',
              expectedVersion: null,
              serverVersion: null,
            })),
          ),
      };
    }
    if (/UNIQUE constraint failed/u.test(message)) {
      await removeBodies(env.bucket, owned);
      return {
        ok: false,
        status: 409,
        error: 'unique_conflict',
        message: 'Another live record has the same DOI.',
      };
    }
    // Any other failure may have happened after the batch applied (a lost response), so the bodies
    // stay; the garbage collector removes them if no row points at them.
    throw error;
  }
  return {
    ok: true,
    results: writes.map((write) => ({
      collection: write.op.collection,
      id: write.op.id,
      version: write.version,
    })),
    appended: fresh.length,
  };
}

function indexValues(index: DocIndex) {
  return Object.fromEntries(
    INDEX_FIELDS.map((field) => [INDEX_COLUMN[field], index[field] ?? null]),
  ) as Record<(typeof INDEX_COLUMN)[DocIndexField], SqlValue>;
}

function insertDoc(db: D1Database, values: Record<(typeof DOC_COLUMNS)[number], SqlValue>, suffix: string) {
  return db
    .prepare(
      `INSERT INTO doc (${DOC_COLUMNS.join(', ')}) VALUES (${DOC_COLUMNS.map(() => '?').join(', ')})${suffix}`,
    )
    .bind(...DOC_COLUMNS.map((column) => values[column]));
}

/**
 * Writes a version's body under a key nobody else holds. `v{n}.json` can already exist when an earlier
 * attempt at the same version failed after its upload, or while another writer races for that version.
 * That object is never shared (its owner may delete it after losing the race), so the body goes to a key
 * with a random suffix.
 */
async function putBody(
  env: StoreEnv,
  op: CommitOp,
  version: number,
  bytes: Uint8Array<ArrayBuffer>,
  sha256: string,
  owned: string[],
) {
  const options = {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { sha256, writtenBy: env.email, writtenAt: env.now().toISOString() },
    onlyIf: { etagDoesNotMatch: '*' },
  };
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const key = bodyKey(op.collection, op.id, version);
  if (await env.bucket.put(key, body, options)) {
    owned.push(key);
    return key;
  }
  const unique = bodyKey(op.collection, op.id, version, crypto.randomUUID());
  if (!(await env.bucket.put(unique, body, options))) throw new Error('Could not store the record body.');
  owned.push(unique);
  return unique;
}

async function removeBodies(bucket: Bucket, keys: string[]) {
  if (!keys.length || !bucket.delete) return;
  try {
    await bucket.delete(keys);
  } catch {
    // Orphans are left to the garbage collector.
  }
}

export async function readBody(bucket: Bucket, row: DocRow) {
  if (row.body_json !== null) return row.body_json;
  if (!row.r2_key) return null;
  const object = await bucket.get(row.r2_key);
  return object ? new Response(object.body).text() : null;
}

/** The public shape of a doc row (camelCase, summary parsed). */
export function docMeta(row: DocRow) {
  return {
    collection: row.collection,
    id: row.id,
    version: row.version,
    size: row.size,
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    labId: row.lab_id,
    visibility: row.visibility,
    ...Object.fromEntries(INDEX_FIELDS.map((field) => [field, row[INDEX_COLUMN[field]]])),
    summary: JSON.parse(row.summary_json) as Record<string, unknown>,
  };
}
