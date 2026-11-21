import { COLLECTIONS } from '../../../src/core/storage/collections';
import { commit, readRows, refKey, type StoreEnv } from './store';

export const CORPUS_PREFIX = 'paperlab/corpora/';
const PAGE_SIZE = 8;

export async function importLegacyCorpora(env: StoreEnv, cursor?: string) {
  const page = await env.bucket.list({
    prefix: CORPUS_PREFIX,
    cursor,
    limit: PAGE_SIZE,
    include: ['customMetadata'],
  });
  const entries = page.objects.map(({ key }) => ({
    key,
    collection: 'corpora' as const,
    id: key.slice(CORPUS_PREFIX.length),
  }));
  const rows = await readRows(env.db, entries);
  const counts = { imported: 0, skipped: 0, failed: 0 };
  for (const { key, collection, id } of entries) {
    const row = rows.get(refKey({ collection, id }));
    if (row && row.deleted_at === null) {
      counts.skipped++;
      continue;
    }
    try {
      const stored = await env.bucket.get(key);
      if (!stored || stored.size > COLLECTIONS.corpora.maxBytes) {
        counts.failed++;
        continue;
      }
      // Commit validates the legacy body and atomically checks create-only against the current live version.
      const text = await new Response(stored.body).text();
      const result = await commit(env, [{ collection, id, op: 'put', expectedVersion: null, text }]);
      if (result.ok) counts.imported++;
      else if ('conflicts' in result && result.conflicts.some((conflict) => conflict.serverVersion !== null))
        counts.skipped++;
      else counts.failed++;
    } catch {
      counts.failed++;
    }
  }
  return { ...counts, cursor: page.truncated ? (page.cursor ?? null) : null };
}
