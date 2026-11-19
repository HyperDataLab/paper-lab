import { PaperSchema, SectionSchema, AuditEventSchema, type Paper } from '@/core/schemas';
import type { StorageDeps } from './storageShared';
import type { DocStore } from './docStore';

/** Records keyed by the paper id, removed with the paper. */
const PER_PAPER = [
  'scgRuns',
  'paperOverviews',
  'paperChecks',
  'paperReviews',
  'paperProbes',
  'measurements',
  'stance',
  'paperContext',
  'paperInsights',
  'grobid',
] as const;

export function createPapersRepository(store: DocStore, deps: StorageDeps) {
  const { now, makeAudit } = deps;
  const papers = {
    async editRole(id: string, sectionId: string, role: Paper['sections'][number]['role']) {
      const validatedRole = SectionSchema.shape.role.parse(role);
      return store.unitOfWork(async (tx) => {
        const row = await tx.get('papers', id);
        const current = row ? PaperSchema.parse(row.doc) : undefined;
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
        await tx.put('papers', id, value);
        const audit = AuditEventSchema.parse({
          ...makeAudit(id, 'edit_label', 'human'),
          before: { sectionId, role: section.role },
          after: { sectionId, role: validatedRole },
        });
        await tx.put('auditEvents', audit.id, audit, null);
        return value;
      });
    },
    async create(input: Paper) {
      const value = PaperSchema.parse(input);
      await store.unitOfWork(async (tx) => {
        await tx.put('papers', value.id, value, null);
        const audit = makeAudit(value.id, 'import_paper', 'human');
        await tx.put('auditEvents', audit.id, audit, null);
      });
      return value;
    },
    async get(id: string) {
      const row = await store.get('papers', id);
      return row ? PaperSchema.parse(row.doc) : undefined;
    },
    /** The paper imported from the file with this SHA-256 (`sha256:<hex>`), if any. */
    async findBySourceHash(sha256: string) {
      const [row] = await store.query('papers', { where: { sourceSha256: sha256 }, limit: 1 });
      return row ? PaperSchema.parse(row.doc) : undefined;
    },
    async list() {
      return (await store.query('papers'))
        .map((row) => PaperSchema.parse(row.doc))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(id: string) {
      await store.unitOfWork(async (tx) => {
        if (!(await tx.get('papers', id))) return;
        await tx.remove('papers', id);
        for (const collection of PER_PAPER) await tx.remove(collection, id);
        for (const row of await tx.query('library', { where: { paperId: id } }))
          await tx.put('library', row.id, {
            ...(row.doc as object),
            paper_id: null,
            file_matches_title: null,
          });
        for (const row of await tx.query('reviewNgrams', { where: { paperId: id } }))
          await tx.remove('reviewNgrams', row.id);
        for (const row of await tx.query('paperRuns', { where: { paperId: id }, select: 'summary' }))
          await tx.remove('paperRuns', row.id);
        const audit = makeAudit(id, 'delete_paper', 'human');
        await tx.put('auditEvents', audit.id, audit, null);
      });
    },
  };
  return papers;
}
