import type { DocQuery, DocStore, DocTx, ExpectedVersion } from './docStore';
import { DataNotConfiguredError, MixedStorageError } from './errors';
import type { RemoteDocStore } from './remoteDocStore';
import { CORPUS_COLLECTIONS } from './remote/corpusCollections';
import { PAPER_COLLECTIONS } from './remote/paperCollections';

export const SPIKE_COLLECTIONS = [
  'extractionProjects',
  'researchDesigns',
  'researchDesignBanks',
  'autoresearchRuns',
] as const;
const spike: ReadonlySet<string> = new Set([
  ...SPIKE_COLLECTIONS,
  ...CORPUS_COLLECTIONS,
  ...PAPER_COLLECTIONS,
]);

export class CompositeDocStore implements DocStore {
  private fallback = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly local: DocStore,
    private readonly remote: RemoteDocStore | null,
  ) {}

  isFallback = () => this.fallback;
  getSaveStatus = () => this.remote?.getSaveStatus() ?? 'idle';
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    const off = this.remote?.subscribe(listener);
    return () => {
      off?.();
      this.listeners.delete(listener);
    };
  };

  private useRemote(collection: string) {
    return this.remote !== null && !this.fallback && spike.has(collection);
  }

  private async dispatch<R>(remote: boolean, action: (store: DocStore) => Promise<R>) {
    if (remote && this.remote) {
      try {
        return await action(this.remote);
      } catch (error) {
        if (!(error instanceof DataNotConfiguredError)) throw error;
        this.fallback = true;
        for (const listener of this.listeners) listener();
      }
    }
    return action(this.local);
  }

  get(collection: string, id: string) {
    return this.dispatch(this.useRemote(collection), (store) => store.get(collection, id));
  }

  getMany(collection: string, ids: readonly string[]) {
    return this.dispatch(this.useRemote(collection), (store) => store.getMany(collection, ids));
  }

  query(collection: string, query?: DocQuery) {
    return this.dispatch(this.useRemote(collection), (store) => store.query(collection, query));
  }

  put(collection: string, id: string, doc: unknown, expected?: ExpectedVersion) {
    return this.dispatch(this.useRemote(collection), (store) => store.put(collection, id, doc, expected));
  }

  remove(collection: string, id: string, expected?: ExpectedVersion) {
    return this.dispatch(this.useRemote(collection), (store) => store.remove(collection, id, expected));
  }

  checkpoint<T>(collection: string, id: string, update: (current: unknown) => T) {
    return this.dispatch(this.useRemote(collection), (store) => {
      if (store.checkpoint) return store.checkpoint(collection, id, update);
      return store.unitOfWork(async (tx) => {
        const row = await tx.get(collection, id);
        const doc = update(row?.doc);
        await tx.put(collection, id, doc);
        return doc;
      });
    });
  }

  flush(collection?: string, id?: string) {
    return this.remote?.flush(collection, id) ?? Promise.resolve();
  }

  async discard(collection: string, id: string) {
    if (spike.has(collection)) await this.remote?.discard(collection, id);
    await this.local.discard?.(collection, id);
  }

  async unitOfWork<R>(fn: (tx: DocTx) => Promise<R>, collections: readonly string[] = []) {
    const remote = collections.some((collection) => this.useRemote(collection));
    if (remote && collections.some((collection) => !this.useRemote(collection)))
      throw new MixedStorageError();
    return this.dispatch(remote, (store) =>
      store.unitOfWork(async (tx) => {
        const usingRemote = store === this.remote;
        const check = (collection: string) => {
          if ((usingRemote && !spike.has(collection)) || (!usingRemote && this.useRemote(collection)))
            throw new MixedStorageError();
        };
        return fn({
          get: (collection, id) => {
            check(collection);
            return tx.get(collection, id);
          },
          getMany: (collection, ids) => {
            check(collection);
            return tx.getMany(collection, ids);
          },
          query: (collection, query) => {
            check(collection);
            return tx.query(collection, query);
          },
          put: (collection, id, doc, expected) => {
            check(collection);
            return tx.put(collection, id, doc, expected);
          },
          remove: (collection, id, expected) => {
            check(collection);
            return tx.remove(collection, id, expected);
          },
          appendAudit: tx.appendAudit,
        });
      }),
    );
  }
}
