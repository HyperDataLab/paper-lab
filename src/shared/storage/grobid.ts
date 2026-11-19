import { GrobidRecordSchema, type GrobidRecord } from '@/core/schemas';
import type { DocStore } from './docStore';

/**
 * One GROBID result per paper. It is not part of the export package: it can be fetched again from the lab's
 * copy of the PDF, and the worker caches it.
 */
export function createGrobidRepository(store: DocStore) {
  return {
    async get(paperId: string): Promise<GrobidRecord | undefined> {
      const row = await store.get('grobid', paperId);
      const parsed = row ? GrobidRecordSchema.safeParse(row.doc) : null;
      // A record from another GROBID version (or an older shape) is treated as missing and fetched again.
      return parsed?.success ? parsed.data : undefined;
    },
    async save(input: GrobidRecord) {
      const value = GrobidRecordSchema.parse(input);
      await store.put('grobid', value.paperId, value);
      return value;
    },
  };
}
