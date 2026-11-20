import { PaperRunSchema, type PaperRun } from '@/core/schemas';
import { PaperRunManifestSchema } from '@/core/storage/paperCheckpoints';
import { appendAudit, type StorageDeps } from './storageShared';
import type { DocReader, DocStore, Versioned } from './docStore';
import { StorageConflictError } from './errors';
import { CheckpointQueue } from './checkpointQueue';
import {
  CheckpointChangedError,
  type CheckpointStore,
  checkpointParts,
  packCheckpoint,
  unpackCheckpoints,
  writeCheckpointParts,
} from './paperCheckpoints';

const collection = 'paperRuns';
const collections = [collection, checkpointParts];
const ref = (id: string) => `run:${id}`;

async function decodeRuns(reader: DocReader, rows: Versioned[]) {
  const manifests = rows.flatMap(({ doc }) => {
    const result = PaperRunManifestSchema.safeParse(doc);
    return result.success ? [result.data] : [];
  });
  const parts = await unpackCheckpoints(
    reader,
    manifests.map(({ id, parts }) => ({ refId: ref(id), parts })),
  );
  const byId = new Map(manifests.map((doc, i) => [doc.id, { ...doc, ...parts[i] }]));
  return rows.map(({ doc }) => {
    const manifest = PaperRunManifestSchema.safeParse(doc);
    return PaperRunSchema.parse(manifest.success ? byId.get(manifest.data.id) : doc);
  });
}

async function readRuns(reader: DocReader, load: () => Promise<Versioned[]>) {
  try {
    return await decodeRuns(reader, await load());
  } catch (error) {
    if (!(error instanceof CheckpointChangedError)) throw error;
    return decodeRuns(reader, await load());
  }
}

export function createPaperRunsRepository(
  store: DocStore,
  deps: StorageDeps,
  checkpointStore: CheckpointStore,
) {
  const { makeAudit } = deps;
  const knownVersions = new Map<string, number>();

  async function observeVersion(id: string, writeId: string) {
    const saved = await checkpointStore.readSaved(collection, id);
    if (!saved || PaperRunManifestSchema.parse(saved.doc).writeId !== writeId)
      throw new StorageConflictError(collection, id, saved?.version ?? null);
    knownVersions.set(id, saved.version);
    return saved.version;
  }

  async function persist(input: PaperRun, create: boolean, expected?: number | null) {
    const value = PaperRunSchema.parse(input);
    const { plan, items, calibrationSnapshots, transitionDone, ...header } = value;
    const { parts, chunks } = await packCheckpoint(value.paperId, ref(value.id), {
      plan,
      items,
      calibrationSnapshots,
      transitionDone,
    });
    const queued = checkpointStore.queued();
    const writeId = crypto.randomUUID();
    const version = await store.unitOfWork(async (tx) => {
      const row = create ? null : await tx.get(collection, value.id);
      const previous = row?.doc as Pick<PaperRun, 'paperId' | 'status'> | undefined;
      if (!create && previous?.paperId !== value.paperId) throw new Error('Run not found');
      await writeCheckpointParts(tx, ref(value.id), chunks);
      const version = await tx.put(
        collection,
        value.id,
        PaperRunManifestSchema.parse({ ...header, parts, writeId }),
        create ? null : expected,
      );
      if (create) await appendAudit(tx, makeAudit(value.paperId, 'start_run', 'system'));
      else if (value.status === 'done' && previous?.status !== 'done')
        await appendAudit(tx, makeAudit(value.paperId, 'finish_run', 'system'));
      return version;
    }, collections);
    return queued ? observeVersion(value.id, writeId) : version;
  }

  const queue = new CheckpointQueue(
    (collection, id) => {
      const version = knownVersions.get(id);
      return version === undefined ? store.get(collection, id) : Promise.resolve({ doc: undefined, version });
    },
    async (_collection, _id, expected, snapshot, onSend) => {
      onSend();
      return persist(PaperRunSchema.parse(snapshot()), false, expected);
    },
  );

  return {
    subscribe: queue.subscribe,
    getSaveStatus: queue.getStatus,
    async create(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      await persist(value, true);
      return value;
    },
    async get(id: string) {
      const [run] = await readRuns(store, async () => {
        const row = await store.get(collection, id);
        if (row) knownVersions.set(id, row.version);
        return row ? [row] : [];
      });
      return run;
    },
    async listByPaper(paperId: string) {
      return readRuns(store, async () => {
        const rows = await store.query(collection, { where: { paperId }, orderBy: 'updatedAt', desc: true });
        for (const { id, version } of rows) knownVersions.set(id, version);
        return rows;
      });
    },
    async checkpoint(input: PaperRun) {
      const value = PaperRunSchema.parse(input);
      if (checkpointStore.queued()) return queue.checkpoint(collection, value.id, () => value);
      await persist(value, false);
      return value;
    },
    flush: (id?: string) => queue.flush(collection, id),
    async save(input: PaperRun) {
      await queue.flush(collection, input.id);
      const value = PaperRunSchema.parse(input);
      await persist(value, false, checkpointStore.queued() ? knownVersions.get(value.id) : undefined);
      return value;
    },
  };
}
