import { canonicalDigest } from '@/core/corpus';
import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import type { DocStore } from './docStore';
import { CorpusConflict, StorageConflictError } from './errors';
import type { StorageDeps } from './storageShared';

const collection = 'corpora';

/** A corpus is one versioned document in the lab store; a write over a newer copy is a CorpusConflict. */
export function createCorporaRepository(store: DocStore, { now, ids }: StorageDeps) {
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
  async function getVersioned(id: string) {
    // A pending checkpoint goes out first, so the read sees it; a failed one leaves the server copy to read.
    await store.flush?.(collection, id).catch(() => undefined);
    const row = await store.get(collection, id);
    return row ? { doc: CorpusSchema.parse(row.doc), version: row.version } : undefined;
  }
  async function saveVersioned(input: Corpus, expectedVersion?: number) {
    const doc = CorpusSchema.parse(input);
    const version = await serial(doc.id, () =>
      withConflict(doc.id, () => store.put(collection, doc.id, doc, expectedVersion)),
    );
    return { doc, version };
  }
  return {
    async get(id: string) {
      return (await getVersioned(id))?.doc;
    },
    getVersioned,
    async reload(id: string) {
      return serial(id, async () => {
        await store.discard?.(collection, id);
        return getVersioned(id);
      });
    },
    async list() {
      return (await store.query(collection, { orderBy: 'updatedAt', desc: true })).map((row) =>
        CorpusSchema.parse(row.doc),
      );
    },
    async save(input: Corpus) {
      return (await saveVersioned(input)).doc;
    },
    saveVersioned,
    async release(corpus: Corpus, expectedVersion: number) {
      const protocol = corpus.protocol.at(-1);
      if (!protocol) throw new Error('Corpus has no protocol');
      const contents = {
        protocol: { version: protocol.version, body: protocol.body },
        members: corpus.members
          .map(({ memberId, role, stratum, identifiers }) => ({ memberId, role, stratum, identifiers }))
          .sort((a, b) => a.memberId.localeCompare(b.memberId)),
      };
      const digest = await canonicalDigest(JSON.parse(JSON.stringify(contents)) as unknown);
      const at = now();
      return saveVersioned(
        {
          ...corpus,
          updatedAt: at,
          releases: [
            ...corpus.releases,
            {
              id: ids(),
              createdAt: at,
              protocolVersion: protocol.version,
              digest,
              memberCount: corpus.members.length,
              registryVersion: null,
            },
          ],
        },
        expectedVersion,
      );
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
