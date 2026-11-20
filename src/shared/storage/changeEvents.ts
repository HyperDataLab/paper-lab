import type { DocStore, DocTx } from './docStore';

export type ChangeListener = (collections: ReadonlySet<string>) => void;
export type SubscribeChanges = (listener: ChangeListener) => () => void;

/**
 * Wraps a store so readers can refresh after a write. The lab store has no live queries, so a write through
 * this wrapper (put, remove, a committed unit of work or an accepted checkpoint) names the collections it touched.
 */
export function withChangeEvents(inner: DocStore): { store: DocStore; subscribe: SubscribeChanges } {
  const listeners = new Set<ChangeListener>();
  const emit = (collections: Iterable<string>) => {
    const touched = new Set(collections);
    if (touched.size) for (const listener of [...listeners]) listener(touched);
  };
  const store: DocStore = {
    get: (collection, id) => inner.get(collection, id),
    getMany: (collection, ids) => inner.getMany(collection, ids),
    query: (collection, query) => inner.query(collection, query),
    async put(collection, id, doc, expected) {
      const version = await inner.put(collection, id, doc, expected);
      emit([collection]);
      return version;
    },
    async remove(collection, id, expected) {
      await inner.remove(collection, id, expected);
      emit([collection]);
    },
    async unitOfWork(fn, collections) {
      const touched = new Set<string>();
      const result = await inner.unitOfWork((tx) => {
        const wrapped: DocTx = {
          get: (collection, id) => tx.get(collection, id),
          getMany: (collection, ids) => tx.getMany(collection, ids),
          query: (collection, query) => tx.query(collection, query),
          put: (collection, id, doc, expected) => {
            touched.add(collection);
            return tx.put(collection, id, doc, expected);
          },
          remove: (collection, id, expected) => {
            touched.add(collection);
            return tx.remove(collection, id, expected);
          },
          appendAudit: tx.appendAudit && ((id, doc) => tx.appendAudit!(id, doc)),
        };
        return fn(wrapped);
      }, collections);
      emit(touched);
      return result;
    },
  };
  // Repositories branch on whether the store coalesces checkpoints, so only forward what the inner store has.
  if (inner.checkpoint)
    store.checkpoint = async <T>(collection: string, id: string, update: (current: unknown) => T) => {
      const doc = await inner.checkpoint!<T>(collection, id, update);
      emit([collection]);
      return doc;
    };
  if (inner.flush) store.flush = (collection, id) => inner.flush!(collection, id);
  if (inner.discard) store.discard = inner.discard.bind(inner);
  return {
    store,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
