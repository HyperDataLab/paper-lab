import { PaperSchema, SectionSchema, AuditEventSchema, type Paper } from '@/core/schemas';
import type { StorageDeps } from './storageShared';
import type { ParagraphDb } from './db';
export function createPapersRepository(db: ParagraphDb, deps: StorageDeps) {
  const { now, makeAudit } = deps;
  const papers = {
    async editRole(id: string, sectionId: string, role: Paper['sections'][number]['role']) {
      const validatedRole = SectionSchema.shape.role.parse(role);
      return db.transaction('rw', db.papers, db.auditEvents, async () => {
        const current = await papers.get(id);
        if (!current) throw new Error('Paper not found');
        const section = current.sections.find((item) => item.id === sectionId);
        if (!section) throw new Error('Section not found');
        if (section.role === validatedRole) return current;
        const value = PaperSchema.parse({
          ...current,
          updatedAt: now(),
          sections: current.sections.map((item) =>
            item.id === sectionId ? { ...item, role: validatedRole } : item,
          ),
        });
        await db.papers.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(id, 'edit_label', 'human'),
            before: { sectionId, role: section.role },
            after: { sectionId, role: validatedRole },
          }),
        );
        return value;
      });
    },
    async create(input: Paper) {
      const value = PaperSchema.parse(input);
      await db.transaction('rw', db.papers, db.auditEvents, async () => {
        await db.papers.add(value);
        await db.auditEvents.add(makeAudit(value.id, 'import_paper', 'human'));
      });
      return value;
    },
    async get(id: string) {
      const value = await db.papers.get(id);
      return value ? PaperSchema.parse(value) : undefined;
    },
    async list() {
      return (await db.papers.toArray())
        .map((value) => PaperSchema.parse(value))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(id: string) {
      await db.transaction(
        'rw',
        [
          db.papers,
          db.paperOverviews,
          db.paperChecks,
          db.paperRuns,
          db.paperReviews,
          db.paperProbes,
          db.measurements,
          db.library,
          db.stance,
          db.paperContext,
          db.paperInsights,
          db.grobid,
          db.reviewNgrams,
          db.auditEvents,
        ],
        async () => {
          if (await db.papers.get(id)) {
            await db.papers.delete(id);
            await db.paperOverviews.delete(id);
            await db.paperChecks.delete(id);
            await db.paperReviews.delete(id);
            await db.paperProbes.delete(id);
            await db.measurements.delete(id);
            await db.stance.delete(id);
            await db.paperContext.delete(id);
            await db.paperInsights.delete(id);
            await db.grobid.delete(id);
            await db.library
              .where('paper_id')
              .equals(id)
              .modify({ paper_id: null, file_matches_title: null });
            await db.reviewNgrams.where('paperId').equals(id).delete();
            await db.paperRuns.where('paperId').equals(id).delete();
            await db.auditEvents.add(makeAudit(id, 'delete_paper', 'human'));
          }
        },
      );
    },
  };
  return papers;
}
