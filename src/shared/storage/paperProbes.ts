import {
  AuditEventSchema,
  PaperProbeRunSchema,
  PaperProbesRecordSchema,
  type AuditEvent,
  type Paper,
  type PaperProbeRun,
} from '@/core/schemas';
import type { DocReader, DocStore } from './docStore';
import { appendAudit, requirePaper } from './storageShared';

export function createPaperProbesRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function read(reader: DocReader, paperId: string) {
    const row = await reader.get('paperProbes', paperId);
    return row ? PaperProbesRecordSchema.parse(row.doc) : undefined;
  }
  return {
    get: (paperId: string) => read(store, paperId),
    async saveRun(paperId: string, input: PaperProbeRun) {
      const run = PaperProbeRunSchema.parse(input);
      return store.unitOfWork(async (tx) => {
        const paper = (await requirePaper(tx, paperId)) as Paper;
        if (
          run.items.some(
            (item) =>
              !paper.paragraphs.some((p) => p.id === item.paragraphId && p.textHash === item.textHash),
          )
        )
          throw new Error('Probe paragraph mismatch');
        const previous = await read(tx, paperId);
        const oldRun = previous?.runs.find((item) => item.id === run.id);
        const at = new Date(
          Math.max(Date.parse(now()), previous ? Date.parse(previous.updatedAt) + 1 : 0),
        ).toISOString();
        const value = PaperProbesRecordSchema.parse({
          schemaVersion: 1,
          paperId,
          updatedAt: at,
          runs: [...(previous?.runs.filter((item) => item.id !== run.id) ?? []), run],
        });
        await tx.put('paperProbes', paperId, value);
        if (!oldRun)
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'run_probe', 'model'),
              at,
              after: { runId: run.id },
            }),
          );
        return value;
      });
    },
  };
}
