import {
  AuditEventSchema,
  PaperProbeRunSchema,
  PaperProbesRecordSchema,
  type AuditEvent,
  type PaperProbeRun,
} from '@/core/schemas';
import type { ParagraphDb } from './db';

export function createPaperProbesRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(paperId: string) {
    const row = await db.paperProbes.get(paperId);
    return row ? PaperProbesRecordSchema.parse(row) : undefined;
  }
  return {
    get,
    async saveRun(paperId: string, input: PaperProbeRun) {
      const run = PaperProbeRunSchema.parse(input);
      return db.transaction('rw', [db.papers, db.paperProbes, db.auditEvents], async () => {
        const paper = await db.papers.get(paperId);
        if (!paper) throw new Error('Paper not found');
        if (
          run.items.some(
            (item) =>
              !paper.paragraphs.some((p) => p.id === item.paragraphId && p.textHash === item.textHash),
          )
        )
          throw new Error('Probe paragraph mismatch');
        const previous = await get(paperId);
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
        await db.paperProbes.put(value);
        if (!oldRun)
          await db.auditEvents.add(
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
