import type { DocQuery, DocStore, DocTx, ExpectedVersion, Versioned } from './docStore';

import { PAPER_COLLECTIONS } from './remote/paperCollections';
import type { DocRef } from './remoteDataClient';
import { RemoteDocStore } from './remoteDocStore';

const paperCollections: ReadonlySet<string> = new Set(PAPER_COLLECTIONS);
type Read = DocRef & { resolve: (row: Versioned | null) => void; reject: (error: unknown) => void };

function batchPaperReads(store: DocStore, remote?: RemoteDocStore) {
  let pending: Read[] = [];
  async function drain() {
    const reads = pending;
    pending = [];
    try {
      if (reads.length > 1 && remote) {
        const rows = await remote.getBatch(reads.map(({ collection, id }) => ({ collection, id })));
        reads.forEach(({ resolve }, i) => resolve(rows[i] ?? null));
        return;
      }
      await Promise.all(
        reads.map(async ({ collection, id, resolve }) => resolve(await store.get(collection, id))),
      );
    } catch (error) {
      for (const { reject } of reads) reject(error);
    }
  }
  return (collection: string, id: string) => {
    if (!remote || !paperCollections.has(collection)) return store.get(collection, id);
    return new Promise<Versioned | null>((resolve, reject) => {
      if (!pending.length) queueMicrotask(() => void drain());
      pending.push({ collection, id, resolve, reject });
    });
  };
}

/**
 * Batches single-document paper reads into one lab request and exposes what checkpointing repositories need.
 * Write events for readers such as the corpus graph come from `withChangeEvents`, which wraps this store.
 */
export function paperStoreReads(store: DocStore) {
  const remote = store instanceof RemoteDocStore ? store : undefined;
  const checkpointStore = {
    queued: () => Boolean(remote),
    readSaved: (collection: string, id: string) =>
      Promise.resolve(remote?.cachedVersion(collection, id) ?? store.get(collection, id)),
  };
  const batched: DocStore = {
    get: batchPaperReads(store, remote),
    getMany: (collection, ids) => store.getMany(collection, ids),
    query: (collection: string, query?: DocQuery) => store.query(collection, query),
    put: (collection: string, id: string, doc: unknown, expected?: ExpectedVersion) =>
      store.put(collection, id, doc, expected),
    remove: (collection: string, id: string, expected?: ExpectedVersion) =>
      store.remove(collection, id, expected),
    unitOfWork: <R>(fn: (tx: DocTx) => Promise<R>, collections?: readonly string[]) =>
      store.unitOfWork(fn, collections),
  };
  if (store.checkpoint) batched.checkpoint = store.checkpoint.bind(store);
  if (store.flush) batched.flush = store.flush.bind(store);
  if (store.discard) batched.discard = store.discard.bind(store);
  return { store: batched, checkpointStore };
}
