import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import type { DocStore } from './docStore';
import { CorpusConflict, StorageConflictError } from './errors';

const collection = 'corpora';

/** A corpus is one versioned document in the lab store; a write over a newer copy is a CorpusConflict. */
export function createCorporaRepository(store: DocStore) {
  async function withConflict<T>(id: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof StorageConflictError) || error instanceof CorpusConflict) throw error;
      throw new CorpusConflict(typeof error.serverVersion === 'number' ? error.serverVersion : null, id);
    }
  }
  /**
   * Writes to one corpus run one after another. The lab store guards a write with the version this tab last saw,
   * so two writes in flight at once would conflict with each other.
   */
  const tails = new Map<string, Promise<unknown>>();
  function serial<T>(id: string, action: () => Promise<T>) {
    const run = (tails.get(id) ?? Promise.resolve()).then(action);
    const tail = run.catch(() => undefined);
    tails.set(id, tail);
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id);
    });
    return run;
  }
  return {
    async get(id: string) {
      // A pending checkpoint goes out first, so the read sees it; a failed one leaves the server copy to read.
      await store.flush?.(collection, id).catch(() => undefined);
      const row = await store.get(collection, id);
      return row ? CorpusSchema.parse(row.doc) : undefined;
    },
    async list() {
      return (await store.query(collection, { orderBy: 'updatedAt', desc: true })).map((row) =>
        CorpusSchema.parse(row.doc),
      );
    },
    async save(input: Corpus) {
      const value = CorpusSchema.parse(input);
      await serial(value.id, () => withConflict(value.id, () => store.put(collection, value.id, value)));
      return value;
    },
    /** Hot writes (a triage batch): coalesced to about one write every 2 s on the lab store. Flush at the end. */
    async checkpoint(input: Corpus) {
      const value = CorpusSchema.parse(input);
      return serial(value.id, () =>
        withConflict(value.id, async () => {
          if (store.checkpoint) return store.checkpoint(collection, value.id, () => value);
          await store.put(collection, value.id, value);
          return value;
        }),
      );
    },
    flush: (id: string) => withConflict(id, () => store.flush?.(collection, id) ?? Promise.resolve()),
    async delete(id: string) {
      await serial(id, () =>
        store.unitOfWork(
          async (tx) => {
            await tx.remove(collection, id);
            await tx.remove('corpusProfiles', id);
            await tx.remove('corpusKeywords', id);
          },
          [collection, 'corpusProfiles', 'corpusKeywords'],
        ),
      );
    },
  };
}
