import {
  AuditEventSchema,
  ExtractionProjectSchema,
  type AuditEvent,
  type ExtractionProject,
} from '@/core/schemas';
import type { ParagraphDb } from './db';

export function createExtractionRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(id: string) {
    const row = await db.extractionProjects.get(id);
    return row ? ExtractionProjectSchema.parse(row) : undefined;
  }
  return {
    get,
    async forPaper(paperId: string) {
      const rows = await db.extractionProjects.toArray();
      return rows.map((row) => ExtractionProjectSchema.parse(row)).find((row) => row.paperId === paperId);
    },
    async list() {
      const rows = await db.extractionProjects.orderBy('updatedAt').reverse().toArray();
      return rows.map((row) => ExtractionProjectSchema.parse(row));
    },
    async save(
      input: ExtractionProject,
      event?: { action: 'run_extraction' | 'review_extraction'; after: unknown },
    ) {
      const value = ExtractionProjectSchema.parse({ ...input, updatedAt: now() });
      await db.transaction('rw', [db.extractionProjects, db.auditEvents], async () => {
        await db.extractionProjects.put(value);
        if (event)
          await db.auditEvents.add(
            AuditEventSchema.parse({
              ...makeAudit(value.id, event.action, event.action === 'run_extraction' ? 'model' : 'human'),
              at: value.updatedAt,
              after: event.after,
            }),
          );
      });
      return value;
    },
    async remove(id: string) {
      await db.transaction(
        'rw',
        [db.extractionProjects, db.researchDesigns, db.researchDesignBanks],
        async () => {
          await db.extractionProjects.delete(id);
          await db.researchDesigns.delete(id);
          await db.researchDesignBanks.delete(id);
        },
      );
    },
  };
}
