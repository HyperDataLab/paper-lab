import { LibraryItemSchema, type LibraryItem } from '@/core/schemas';
import type { DocReader, DocStore } from './docStore';

type Patch = Partial<Omit<LibraryItem, 'id' | 'doi' | 'addedAt' | 'schemaVersion'>>;

/** Library items with any of these DOIs, in a single index query. */
export async function libraryByDois(reader: DocReader, dois: readonly string[]) {
  if (!dois.length) return [];
  const rows = await reader.query('library', { whereIn: { field: 'doi', values: [...new Set(dois)] } });
  return rows.map((row) => LibraryItemSchema.parse(row.doc));
}

export function createLibraryRepository(store: DocStore, now: () => string, ids: () => string) {
  async function get(id: string) {
    const row = await store.get('library', id);
    return row ? LibraryItemSchema.parse(row.doc) : undefined;
  }
  async function update(id: string, patch: Patch) {
    return store.unitOfWork(async (tx) => {
      const row = await tx.get('library', id);
      if (!row) throw new Error('Library item not found');
      const current = LibraryItemSchema.parse(row.doc);
      const value = LibraryItemSchema.parse({ ...current, ...patch, updatedAt: now() });
      await tx.put('library', id, value);
      return value;
    });
  }
  return {
    get,
    update,
    async list() {
      return (await store.query('library'))
        .map((row) => LibraryItemSchema.parse(row.doc))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.doi.localeCompare(b.doi));
    },
    /** Adds what is new. A DOI already in the library is counted, not reset. */
    async addDois(dois: string[]) {
      return store.unitOfWork(async (tx) => {
        const known = new Set((await libraryByDois(tx, dois)).map((row) => row.doi));
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
        for (const item of added) await tx.put('library', item.id, item, null);
        return { added, duplicates: known.size };
      });
    },
    async remove(ids_: string[]) {
      await store.unitOfWork(async (tx) => {
        for (const id of ids_) await tx.remove('library', id);
      });
    },
  };
}
