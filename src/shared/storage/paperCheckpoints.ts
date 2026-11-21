import { sourceHash } from '@/core/text/hash';
import { PaperCheckpointChunkSchema, type Parts } from '@/core/storage/paperCheckpoints';
import type { DocReader, DocTx } from './docStore';

export type CheckpointStore = {
  queued: () => boolean;
  readSaved: DocReader['get'];
};

export const checkpointParts = 'paperCheckpointParts';
type Chunk = ReturnType<typeof PaperCheckpointChunkSchema.parse>;

/** Leave room for JSON escaping, including control characters and split surrogate pairs. */
const CHUNK_LENGTH = 120_000;

export async function packCheckpoint(paperId: string, refId: string, fields: Record<string, unknown>) {
  const chunks: Chunk[] = [];
  const parts: Parts = {};
  const pending: Promise<void>[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const json = JSON.stringify(value);
    const count = Math.ceil(json.length / CHUNK_LENGTH);
    const hashes: string[] = [];
    parts[field] = hashes;
    for (let i = 0; i < count; i++) {
      const data = json.slice(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
      pending.push(
        sourceHash(JSON.stringify(data)).then((hash) => {
          hashes[i] = hash;
          const id = partId(refId, field, i);
          chunks.push(
            PaperCheckpointChunkSchema.parse({
              schemaVersion: 1,
              id,
              paperId,
              kind: 'chunk',
              refId,
              hash,
              data,
            }),
          );
        }),
      );
    }
  }
  await Promise.all(pending);
  return { parts, chunks };
}

const partId = (refId: string, field: string, index: number) => `${refId}:${field}:${index}`;

export class CheckpointChangedError extends Error {}

export async function unpackCheckpoints(reader: DocReader, refs: { refId: string; parts: Parts }[]) {
  const fields = refs.map(({ refId, parts }) =>
    Object.entries(parts).map(([field, hashes]) => ({
      field,
      hashes,
      ids: hashes.map((_, index) => partId(refId, field, index)),
    })),
  );
  const ids = fields.flatMap((doc) => doc.flatMap((field) => field.ids));
  if (!ids.length) return refs.map(() => ({}));
  const rows = await reader.getMany(checkpointParts, ids);
  if (rows.some((row) => row === null)) throw new CheckpointChangedError('Checkpoint changed while loading');
  const bodies = new Map(ids.map((id, i) => [id, rows[i]?.doc]));
  return fields.map((doc) =>
    Object.fromEntries(
      doc.map(({ field, ids, hashes }) => {
        const chunks = ids.map((id) => PaperCheckpointChunkSchema.parse(bodies.get(id)));
        if (chunks.some((chunk, i) => chunk.hash !== hashes[i]))
          throw new CheckpointChangedError('Checkpoint changed while loading');
        return [field, JSON.parse(chunks.map(({ data }) => data).join('')) as unknown];
      }),
    ),
  );
}

export async function writeCheckpointParts(tx: DocTx, refId: string, chunks: Chunk[]) {
  const rows = await tx.query(checkpointParts, { where: { refId }, select: 'summary' });
  const current = new Map(rows.map((row) => [row.id, row]));
  for (const chunk of chunks) {
    const previous = current.get(chunk.id);
    if ((previous?.doc as { hash?: string } | undefined)?.hash !== chunk.hash)
      await tx.put(checkpointParts, chunk.id, chunk, previous?.version ?? null);
    current.delete(chunk.id);
  }
  for (const { id, version } of current.values()) await tx.remove(checkpointParts, id, version);
}
