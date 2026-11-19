import {
  AuditEventSchema,
  ExtractionProjectSchema,
  type AuditEvent,
  type ExtractionProject,
} from '@/core/schemas';
import type { DocStore } from './docStore';

export function createExtractionRepository(
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(id: string) {
    const row = await store.get('extractionProjects', id);
    return row ? ExtractionProjectSchema.parse(row.doc) : undefined;
  }
  return {
    get,
    async forPaper(paperId: string) {
      const [row] = await store.query('extractionProjects', { where: { paperId }, limit: 1 });
      return row ? ExtractionProjectSchema.parse(row.doc) : undefined;
    },
    async list() {
      const rows = await store.query('extractionProjects', { orderBy: 'updatedAt', desc: true });
      return rows.map((row) => ExtractionProjectSchema.parse(row.doc));
    },
    async save(
      input: ExtractionProject,
      event?: { action: 'run_extraction' | 'review_extraction'; after: unknown },
    ) {
      const value = ExtractionProjectSchema.parse({ ...input, updatedAt: now() });
      await store.unitOfWork(async (tx) => {
        await tx.put('extractionProjects', value.id, value);
        if (event) {
          const audit = AuditEventSchema.parse({
            ...makeAudit(value.id, event.action, event.action === 'run_extraction' ? 'model' : 'human'),
            at: value.updatedAt,
            after: event.after,
          });
          await tx.put('auditEvents', audit.id, audit, null);
        }
      });
      return value;
    },
    async remove(id: string) {
      await store.unitOfWork(async (tx) => {
        await tx.remove('extractionProjects', id);
        await tx.remove('researchDesigns', id);
        await tx.remove('researchDesignBanks', id);
        for (const run of await tx.query('autoresearchRuns', { where: { projectId: id }, select: 'summary' }))
          await tx.remove('autoresearchRuns', run.id);
      });
    },
  };
}
