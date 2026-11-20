import type { Bucket } from '../deps';
import type { D1Database } from '../kg/bindings';
import { DATA_PREFIX, parseBodyKey, readRows, refKey } from './store';

/** Bodies this many versions behind the current one are removed at once. */
export const GC_KEEP_VERSIONS = 3;
/** Any body that is not a record's current one is removed after this age (covers failed uploads too). */
export const GC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const GC_PAGE = 500;
export const GC_MAX_DELETES = 100;
const CURSOR = 'bodies_cursor';

/**
 * One small step of orphan-body garbage collection, run by the cron: reads one listing page of
 * `paperlab/data/`, removes bodies that no doc row points at once they are old enough, and saves the
 * listing cursor for the next run. A body newer than the current version (a commit in flight, or one
 * that failed) is only removed by age, so an in-flight commit never loses its body.
 */
export async function collectOrphanBodies(db: D1Database, bucket: Bucket, now: Date) {
  if (!bucket.delete) return { scanned: 0, deleted: 0, done: true };
  const [state] = await db.batch<{ value: string | null }>([
    db.prepare('SELECT value FROM data_gc_state WHERE name = ?').bind(CURSOR),
  ]);
  const cursor = state?.results[0]?.value ?? undefined;
  const page = await bucket.list({
    prefix: DATA_PREFIX,
    cursor,
    limit: GC_PAGE,
    include: ['customMetadata'],
  });
  const bodies = page.objects.flatMap((object) => {
    const ref = parseBodyKey(object.key);
    const written = object.uploaded?.getTime() ?? Date.parse(object.customMetadata?.writtenAt ?? '');
    return ref ? [{ ...ref, key: object.key, written: Number.isNaN(written) ? now.getTime() : written }] : [];
  });
  const rows = await readRows(db, bodies);
  const doomed = bodies
    .filter((body) => {
      const row = rows.get(refKey(body));
      if (row?.r2_key === body.key) return false;
      const old = now.getTime() - body.written > GC_MAX_AGE_MS;
      return old || (!!row && body.version <= row.version - GC_KEEP_VERSIONS);
    })
    .slice(0, GC_MAX_DELETES)
    .map((body) => body.key);
  if (doomed.length) await bucket.delete(doomed);
  // A page with more doomed bodies than one run deletes is read again next time.
  const next =
    doomed.length === GC_MAX_DELETES ? (cursor ?? null) : page.truncated ? (page.cursor ?? null) : null;
  await db.batch([
    db
      .prepare(
        'INSERT INTO data_gc_state (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value',
      )
      .bind(CURSOR, next),
  ]);
  return {
    scanned: page.objects.length,
    deleted: doomed.length,
    done: next === null && doomed.length < GC_MAX_DELETES,
  };
}
