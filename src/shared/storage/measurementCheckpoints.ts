import { MeasurementPendingSchema, type MeasurementPending } from '@/core/schemas';
import { MeasurementManifestSchema } from '@/core/storage/paperCheckpoints';
import { CheckpointQueue } from './checkpointQueue';
import type { DocReader, DocStore, DocTx } from './docStore';
import {
  type CheckpointStore,
  checkpointParts,
  packCheckpoint,
  unpackCheckpoints,
  writeCheckpointParts,
} from './paperCheckpoints';
import { StorageConflictError } from './errors';
import { requirePaper } from './storageShared';

export const measurementRef = (paperId: string) => `measurement:${paperId}`;

export async function readMeasurementPending(reader: DocReader, paperId: string) {
  const row = await reader.get(checkpointParts, measurementRef(paperId));
  if (!row) return undefined;
  const manifest = MeasurementManifestSchema.parse(row.doc);
  const [fields] = await unpackCheckpoints(reader, [
    { refId: measurementRef(paperId), parts: manifest.parts },
  ]);
  return { pending: MeasurementPendingSchema.parse(fields), updatedAt: manifest.updatedAt };
}

export async function listMeasurementPending(reader: DocReader) {
  const manifests = (await reader.query(checkpointParts, { where: { kind: 'measurement' } })).map(({ doc }) =>
    MeasurementManifestSchema.parse(doc),
  );
  const parts = await unpackCheckpoints(
    reader,
    manifests.map(({ id, parts }) => ({ refId: id, parts })),
  );
  return manifests.map(({ paperId, updatedAt }, i) => ({
    paperId,
    updatedAt,
    pending: MeasurementPendingSchema.parse(parts[i]),
  }));
}

export async function clearMeasurementPending(tx: DocTx, paperId: string) {
  const id = measurementRef(paperId);
  const row = await tx.get(checkpointParts, id);
  if (!row) return;
  await writeCheckpointParts(tx, id, []);
  await tx.remove(checkpointParts, id, row.version);
}

export function createMeasurementCheckpoints(
  store: DocStore,
  now: () => string,
  checkpointStore: CheckpointStore,
) {
  const versions = new Map<string, number | null>();
  async function persist(paperId: string, pending: MeasurementPending, expected?: number | null) {
    const id = measurementRef(paperId);
    const writeId = crypto.randomUUID();
    const { parts, chunks } = await packCheckpoint(paperId, id, pending);
    const manifest = MeasurementManifestSchema.parse({
      schemaVersion: 1,
      id,
      paperId,
      kind: 'measurement',
      updatedAt: now(),
      parts,
      writeId,
    });
    await store.unitOfWork(
      async (tx) => {
        await requirePaper(tx, paperId);
        await writeCheckpointParts(tx, id, chunks);
        await tx.put(checkpointParts, id, manifest, expected);
      },
      ['papers', checkpointParts],
    );
    const saved = await checkpointStore.readSaved(checkpointParts, id);
    if (!saved || MeasurementManifestSchema.parse(saved.doc).writeId !== writeId)
      throw new StorageConflictError(checkpointParts, id, saved?.version ?? null);
    versions.set(paperId, saved.version);
    return saved.version;
  }
  const queue = new CheckpointQueue(
    (collection, id) => {
      const version = versions.get(id);
      return version === undefined
        ? store.get(collection, measurementRef(id))
        : Promise.resolve(version === null ? null : { doc: undefined, version });
    },
    (_collection, paperId, expected, snapshot, onSend) => {
      onSend();
      return persist(paperId, MeasurementPendingSchema.parse(snapshot()), expected);
    },
  );
  return {
    reset: (id: string) => versions.delete(id),
    save: persist,
    subscribe: queue.subscribe,
    getSaveStatus: queue.getStatus,
    async checkpoint(paperId: string, pending: MeasurementPending) {
      const value = MeasurementPendingSchema.parse(pending);
      if (checkpointStore.queued()) return queue.checkpoint(checkpointParts, paperId, () => value);
      await persist(paperId, value, versions.get(paperId));
      return value;
    },
    flush: (paperId?: string) => queue.flush(checkpointParts, paperId),
  };
}
