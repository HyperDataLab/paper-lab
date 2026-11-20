import { LibraryItemSchema, type LibraryItem } from '@/core/schemas';
import type { DocIndexField } from '@/core/storage/collections';
import type { DocReader, DocStore } from './docStore';
import { DuplicateDoiError, UniqueConflictError } from './errors';

type Patch = Partial<Omit<LibraryItem, 'id' | 'doi' | 'addedAt' | 'schemaVersion'>>;

const COLLECTIONS = ['library'] as const;
/** The lab server takes at most 500 values in one `whereIn`. */
const WHERE_IN_MAX = 500;
/** The lab server takes at most 100 writes in one commit. */
const COMMIT_MAX = 100;

const chunks = <T>(values: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

async function libraryWhereIn(reader: DocReader, field: DocIndexField, values: readonly string[]) {
  const pages = await Promise.all(
    chunks([...new Set(values)], WHERE_IN_MAX).map((part) =>
      reader.query('library', { whereIn: { field, values: part } }),
    ),
  );
  return pages.flat().map((row) => LibraryItemSchema.parse(row.doc));
}

/** Library items with any of these DOIs, in one index query per 500 DOIs. */
export function libraryByDois(reader: DocReader, dois: readonly string[]) {
  return dois.length ? libraryWhereIn(reader, 'doi', dois) : Promise.resolve([]);
}

/** Library items attached to any of these papers. */
export function libraryByPapers(reader: DocReader, paperIds: readonly string[]) {
  return paperIds.length ? libraryWhereIn(reader, 'paperId', paperIds) : Promise.resolve([]);
}

/** The lab server keeps one live library item per DOI; its refusal becomes a clear error. */
async function uniqueDoi<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof UniqueConflictError) throw new DuplicateDoiError(error);
    throw error;
  }
}

export function createLibraryRepository(store: DocStore, now: () => string, ids: () => string) {
  async function get(id: string) {
    const row = await store.get('library', id);
    return row ? LibraryItemSchema.parse(row.doc) : undefined;
  }
  async function update(id: string, patch: Patch) {
    return uniqueDoi(() =>
      store.unitOfWork(async (tx) => {
        const row = await tx.get('library', id);
        if (!row) throw new Error('Library item not found');
        const current = LibraryItemSchema.parse(row.doc);
        const value = LibraryItemSchema.parse({ ...current, ...patch, updatedAt: now() });
        await tx.put('library', id, value);
        return value;
      }, COLLECTIONS),
    );
  }
  function addBatch(dois: string[]) {
    return store.unitOfWork(async (tx) => {
      const known = new Set((await libraryByDois(tx, dois)).map((row) => row.doi));
      const at = now();
      const added = [...new Set(dois)]
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
    }, COLLECTIONS);
  }
  return {
    get,
    update,
    async list() {
      return (await store.query('library'))
        .map((row) => LibraryItemSchema.parse(row.doc))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.doi.localeCompare(b.doi));
    },
    /**
     * Adds what is new. A DOI already in the library is counted, not reset. Long lists commit 100 at a time; each
     * batch re-reads what is there, so running the same list again after a failure adds only the rest.
     */
    async addDois(dois: string[]) {
      return uniqueDoi(async () => {
        const result: { added: LibraryItem[]; duplicates: number } = { added: [], duplicates: 0 };
        for (const part of chunks(dois, COMMIT_MAX)) {
          const { added, duplicates } = await addBatch(part);
          result.added.push(...added);
          result.duplicates += duplicates;
        }
        return result;
      });
    },
    async remove(ids_: string[]) {
      for (const part of chunks(ids_, COMMIT_MAX))
        await store.unitOfWork(async (tx) => {
          for (const id of part) await tx.remove('library', id);
        }, COLLECTIONS);
    },
    /**
     * Clears the links from library items to a deleted paper. It is idempotent and commits on its own, because
     * papers may live in another store than the library.
     */
    async detachPaper(paperId: string) {
      await store.unitOfWork(async (tx) => {
        for (const item of await libraryByPapers(tx, [paperId]))
          await tx.put(
            'library',
            item.id,
            LibraryItemSchema.parse({ ...item, paper_id: null, file_matches_title: null }),
          );
      }, COLLECTIONS);
    },
  };
}
