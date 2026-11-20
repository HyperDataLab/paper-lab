import { z } from 'zod';
import { COLLECTIONS, isCollectionName } from '../../../src/core/storage/collections';
import type { Deps } from '../deps';
import { collectionSchema, filterSchema, queryGuardSchema, queryPlan } from './queryPlan';
import {
  commit,
  docMeta,
  etagOf,
  parseEtag,
  readBody,
  readRows,
  refKey,
  type CommitResult,
  type DocRow,
  type StoreEnv,
} from './store';

export const DATA_PATH_PREFIX = '/v1/data/';
const DOC_PATH = /^\/v1\/data\/([A-Za-z]+)\/([^/]+)$/u;
/** A commit request carries whole bodies; each body still has its collection's own cap. */
export const MAX_COMMIT_BYTES = 32 * 1024 * 1024;
/** Bodies returned by one query or batch-get stop at this many bytes; the rest are deferred. */
export const MAX_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_QUERY_LIMIT = 500;
export const MAX_BODY_ROWS = 100;
export const MAX_BATCH_IDS = 100;
export const MAX_COMMIT_OPS = 100;
export const MAX_COMMIT_APPENDS = 200;

type Headers = Record<string, string>;
const fail = (status: number, error: string, message: string, headers: Headers, extra: object = {}) =>
  Response.json(
    { error, message, ...extra },
    { status, headers: { ...headers, 'Cache-Control': 'no-store' } },
  );
const ok = (status: number, value: unknown, headers: Headers, extra: Headers = {}) =>
  Response.json(value, { status, headers: { ...headers, 'Cache-Control': 'no-store', ...extra } });

const idSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\P{Cc}+$/u);
const versionSchema = z.number().int().positive().nullable();

const QuerySchema = z.strictObject({
  collection: collectionSchema,
  ...filterSchema,
  limit: z.number().int().positive().max(MAX_QUERY_LIMIT).default(100),
  cursor: z.string().max(2000).nullable().optional(),
  include: z.enum(['summary', 'body']).default('summary'),
  includeDeleted: z.boolean().default(false),
});
const BatchGetSchema = z.strictObject({
  collection: collectionSchema,
  ids: z.array(idSchema).min(1).max(MAX_BATCH_IDS),
});
const CommitSchema = z.strictObject({
  ops: z
    .array(
      z.strictObject({
        collection: collectionSchema,
        id: idSchema,
        expectedVersion: versionSchema,
        op: z.enum(['put', 'delete']),
        body: z.unknown().optional(),
      }),
    )
    .max(MAX_COMMIT_OPS)
    .default([]),
  guards: z
    .array(z.strictObject({ collection: collectionSchema, id: idSchema, expectedVersion: versionSchema }))
    .max(MAX_COMMIT_OPS)
    .default([]),
  queryGuards: z.array(queryGuardSchema).max(MAX_COMMIT_OPS).default([]),
  audit: z
    .array(z.strictObject({ collection: collectionSchema, id: idSchema, body: z.unknown() }))
    .max(MAX_COMMIT_APPENDS)
    .default([]),
});

/**
 * The central lab store (ADR-0007): conditional reads and writes of one record, index queries over the
 * D1 rows, batch reads, and atomic multi-record commits. Any signed-in lab account may use it (C5 adds
 * permissions); writes are stamped with the caller's email.
 */
export async function handleData(
  deps: Deps,
  request: Request,
  path: string,
  email: string,
  headers: Headers,
) {
  const db = deps.data;
  if (!db) return fail(503, 'data_not_configured', 'The lab data store is unavailable.', headers);
  const env: StoreEnv = { db, bucket: deps.bucket, now: deps.now, email };

  if (path === '/v1/data/query' || path === '/v1/data/batch-get' || path === '/v1/data/commit') {
    if (request.method !== 'POST') return fail(405, 'bad_request', 'Use POST.', headers);
    if (Number(request.headers.get('content-length')) > MAX_COMMIT_BYTES)
      return fail(413, 'too_large', 'The request is too large.', headers);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_COMMIT_BYTES)
      return fail(413, 'too_large', 'The request is too large.', headers);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return fail(400, 'bad_request', 'The request is not JSON.', headers);
    }
    if (path === '/v1/data/query') return query(env, value, headers);
    if (path === '/v1/data/batch-get') return batchGet(env, value, headers);
    return commitRoute(env, value, headers);
  }

  const match = DOC_PATH.exec(path);
  let id: string | undefined;
  try {
    id = match ? decodeURIComponent(match[2] as string) : undefined;
  } catch {
    id = undefined;
  }
  const collection = match?.[1];
  if (!id || !idSchema.safeParse(id).success) return fail(400, 'bad_request', 'Invalid path.', headers);
  if (!isCollectionName(collection)) return fail(404, 'unknown_collection', 'Unknown collection.', headers);

  if (request.method === 'GET') {
    const row = (await readRows(db, [{ collection, id }])).get(refKey({ collection, id }));
    if (!row || row.deleted_at) return fail(404, 'not_found', 'No such record.', headers);
    const etag = etagOf(row.version);
    // A weak validator matches for a GET, as on the other /v1 routes.
    if (parseEtag(request.headers.get('if-none-match')?.replace(/^W\//u, '') ?? null) === row.version)
      return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
    const body = await readBody(deps.bucket, row);
    if (body === null) return fail(500, 'internal', 'The record body is missing.', headers);
    return new Response(body, {
      status: 200,
      headers: {
        ...headers,
        ETag: etag,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-cache',
      },
    });
  }

  if (request.method === 'PUT') {
    const ifMatch = request.headers.get('if-match');
    const create = request.headers.get('if-none-match') === '*';
    const expected = parseEtag(ifMatch);
    if ((ifMatch !== null) === create || (ifMatch !== null && expected === null))
      return fail(428, 'precondition_required', 'Send If-Match: "v<n>" or If-None-Match: *.', headers);
    const limit = COLLECTIONS[collection].maxBytes;
    if (Number(request.headers.get('content-length')) > limit)
      return fail(413, 'too_large', `The body exceeds ${limit} bytes.`, headers);
    const text = await request.text();
    const result = await commit(env, [
      { collection, id, op: 'put', expectedVersion: create ? null : expected, text },
    ]);
    return writeResponse(result, create ? 201 : 200, headers);
  }

  if (request.method === 'DELETE') {
    const expected = parseEtag(request.headers.get('if-match'));
    if (expected === null) return fail(428, 'precondition_required', 'Send If-Match: "v<n>".', headers);
    return writeResponse(
      await commit(env, [{ collection, id, op: 'delete', expectedVersion: expected }]),
      200,
      headers,
    );
  }
  return fail(405, 'bad_request', 'Use GET, PUT or DELETE.', headers);
}

function writeResponse(result: CommitResult, status: number, headers: Headers) {
  if (!result.ok) return failure(result, headers);
  const version = result.results[0]?.version as number;
  return ok(status, { version }, headers, { ETag: etagOf(version) });
}

function failure(result: Exclude<CommitResult, { ok: true }>, headers: Headers) {
  if ('conflicts' in result) {
    const first = result.conflicts[0];
    return fail(409, 'version_conflict', 'The record changed since it was read.', headers, {
      serverVersion: first?.serverVersion ?? null,
      conflicts: result.conflicts,
    });
  }
  return fail(result.status, result.error, result.message, headers);
}

async function commitRoute(env: StoreEnv, value: unknown, headers: Headers) {
  const parsed = CommitSchema.safeParse(value);
  if (!parsed.success)
    return fail(400, 'bad_request', `Invalid commit: ${parsed.error.issues[0]?.message ?? ''}`, headers);
  const { ops, guards, audit, queryGuards } = parsed.data;
  if (!ops.length && !audit.length && !guards.length && !queryGuards.length)
    return fail(400, 'bad_request', 'Nothing to commit.', headers);
  for (const op of ops)
    if (op.op === 'put' && op.body === undefined)
      return fail(400, 'bad_request', `The put of ${op.collection}/${op.id} has no body.`, headers);
  const result = await commit(
    env,
    ops.map((op) => ({
      collection: op.collection,
      id: op.id,
      op: op.op,
      expectedVersion: op.expectedVersion,
      text: op.op === 'put' ? JSON.stringify(op.body) : undefined,
    })),
    guards,
    audit.map((entry) => ({ collection: entry.collection, id: entry.id, text: JSON.stringify(entry.body) })),
    queryGuards,
  );
  if (!result.ok) return failure(result, headers);
  return ok(200, { results: result.results, appended: result.appended }, headers);
}

/** Adds bodies to rows in order until the response cap; the rows after it are returned as deferred. */
async function withBodies(env: StoreEnv, rows: DocRow[]) {
  let total = 0;
  const included: DocRow[] = [];
  for (const row of rows) {
    if (included.length && total + row.size > MAX_RESPONSE_BODY_BYTES) break;
    total += row.size;
    included.push(row);
  }
  const items = await Promise.all(
    included.map(async (row) => {
      const text = await readBody(env.bucket, row);
      return { ...docMeta(row), body: text === null ? null : (JSON.parse(text) as unknown) };
    }),
  );
  return { items, deferred: rows.slice(included.length) };
}

// Base64 of the UTF-8 JSON, since sort keys (titles) need not be Latin-1.
const encodeCursor = (value: unknown[]) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
function decodeCursor(cursor: string): [string | number, string] | null {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[1] === 'string' &&
      ['string', 'number'].includes(typeof value[0])
    )
      return value as [string | number, string];
  } catch {
    // Fall through.
  }
  return null;
}

async function query(env: StoreEnv, value: unknown, headers: Headers) {
  const parsed = QuerySchema.safeParse(value);
  if (!parsed.success)
    return fail(400, 'bad_request', `Invalid query: ${parsed.error.issues[0]?.message ?? ''}`, headers);
  const request = parsed.data;
  const limit = request.include === 'body' ? Math.min(request.limit, MAX_BODY_ROWS) : request.limit;
  const { conditions, values, order, ordering } = queryPlan(request, request.includeDeleted);
  if (request.cursor) {
    const cursor = decodeCursor(request.cursor);
    if (!cursor) return fail(400, 'bad_request', 'Invalid cursor.', headers);
    conditions.push(`(${order}, id) ${request.desc ? '<' : '>'} (?, ?)`);
    values.push(...cursor);
  }
  const [result] = await env.db.batch<DocRow & { sort_key: string | number }>([
    env.db
      .prepare(
        `SELECT *, ${order} AS sort_key FROM doc WHERE ${conditions.join(' AND ')} ORDER BY ${ordering} LIMIT ?`,
      )
      .bind(...values, limit + 1),
  ]);
  const rows = result?.results ?? [];
  let page = rows.slice(0, limit);
  let more = rows.length > limit;
  let items: unknown[];
  if (request.include === 'body') {
    const loaded = await withBodies(env, page);
    items = loaded.items;
    if (loaded.deferred.length) {
      page = page.slice(0, loaded.items.length);
      more = true;
    }
  } else items = page.map(docMeta);
  const last = page.at(-1);
  return ok(
    200,
    { items, nextCursor: more && last ? encodeCursor([last.sort_key, last.id]) : null },
    headers,
  );
}

async function batchGet(env: StoreEnv, value: unknown, headers: Headers) {
  const parsed = BatchGetSchema.safeParse(value);
  if (!parsed.success)
    return fail(400, 'bad_request', `Invalid batch-get: ${parsed.error.issues[0]?.message ?? ''}`, headers);
  const { collection, ids } = parsed.data;
  const unique = [...new Set(ids)];
  const rows = await readRows(
    env.db,
    unique.map((id) => ({ collection, id })),
  );
  const found = unique
    .map((id) => rows.get(refKey({ collection, id })))
    .filter((row): row is DocRow => !!row && !row.deleted_at);
  const { items, deferred } = await withBodies(env, found);
  const foundIds = new Set(found.map((row) => row.id));
  return ok(
    200,
    { items, missing: unique.filter((id) => !foundIds.has(id)), deferred: deferred.map((row) => row.id) },
    headers,
  );
}
