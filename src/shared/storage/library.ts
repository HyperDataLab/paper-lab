import { LibraryItemSchema, type LibraryItem } from '@/core/schemas';
import type { ParagraphDb } from './db';

type Patch = Partial<Omit<LibraryItem, 'id' | 'doi' | 'addedAt' | 'schemaVersion'>>;

export function createLibraryRepository(db: ParagraphDb, now: () => string, ids: () => string) {
  async function get(id: string) {
    const row = await db.library.get(id);
    return row ? LibraryItemSchema.parse(row) : undefined;
  }
  async function update(id: string, patch: Patch) {
    return db.transaction('rw', db.library, async () => {
      const current = await get(id);
      if (!current) throw new Error('Library item not found');
      const value = LibraryItemSchema.parse({ ...current, ...patch, updatedAt: now() });
      await db.library.put(value);
      return value;
    });
  }
  return {
    get,
    update,
    async list() {
      return (await db.library.toArray())
        .map((row) => LibraryItemSchema.parse(row))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.doi.localeCompare(b.doi));
    },
    /** Adds what is new. A DOI already in the library is counted, not reset. */
    async addDois(dois: string[]) {
      return db.transaction('rw', db.library, async () => {
        const known = new Set((await db.library.where('doi').anyOf(dois).toArray()).map((row) => row.doi));
        const at = now();
        const added = dois
          .filter((doi) => !known.has(doi))
          .map((doi) =>
            LibraryItemSchema.parse({
              schemaVersion: 1,
              id: ids(),
              doi,
              addedAt: at,
              updatedAt: at,
              lookup: 'pending',
              title: null,
              authors: [],
              year: null,
              venue: null,
              access: 'unknown',
              oa_sources: [],
              arxiv_id: null,
              taxonomy: null,
              openalex_id: null,
              paper_id: null,
              file_matches_title: null,
              error: null,
            }),
          );
        await db.library.bulkAdd(added);
        return { added, duplicates: known.size };
      });
    },
    async remove(ids_: string[]) {
      await db.library.bulkDelete(ids_);
    },
  };
}
