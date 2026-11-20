import { PaperSchema, PaperSummarySchema, SectionSchema, AuditEventSchema, type Paper } from '@/core/schemas';
import { appendAudit, type StorageDeps } from './storageShared';
import type { DocStore } from './docStore';
import { checkpointParts } from './paperCheckpoints';

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
      return store.unitOfWork(
        async (tx) => {
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
          await appendAudit(tx, audit);
          return value;
        },
        ['papers'],
      );
    },
    async create(input: Paper) {
      const value = PaperSchema.parse(input);
      await store.unitOfWork(
        async (tx) => {
          await tx.put('papers', value.id, value, null);
          const audit = makeAudit(value.id, 'import_paper', 'human');
          await appendAudit(tx, audit);
        },
        ['papers'],
      );
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
    async getMany(ids: readonly string[]) {
      return (await store.getMany('papers', ids)).map((row) =>
        row ? PaperSchema.parse(row.doc) : undefined,
      );
    },
    async listSummaries() {
      return (await store.query('papers', { select: 'summary', orderBy: 'updatedAt', desc: true })).map(
        ({ doc }) => PaperSummarySchema.parse(doc),
      );
    },
    async list() {
      return (await store.query('papers'))
        .map((row) => PaperSchema.parse(row.doc))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(id: string) {
      await store.unitOfWork(
        async (tx) => {
          if (!(await tx.get('papers', id))) return;
          await tx.remove('papers', id);
          await Promise.all(
            PER_PAPER.map(async (collection) => {
              const row = await tx.get(collection, id);
              if (row) await tx.remove(collection, id, row.version);
            }),
          );
          const audit = makeAudit(id, 'delete_paper', 'human');
          await appendAudit(tx, audit);
        },
        ['papers', ...PER_PAPER],
      );
      // Large papers can have more children than a single worker commit accepts.
      for (const collection of ['paperRuns', checkpointParts, 'reviewNgrams']) {
        let count: number;
        do {
          count = await store.unitOfWork(
            async (tx) => {
              const rows = await tx.query(collection, {
                where: { paperId: id },
                select: 'summary',
                limit: 50,
              });
              for (const row of rows) await tx.remove(collection, row.id, row.version);
              return rows.length;
            },
            [collection],
          );
        } while (count === 50);
      }
      // Library links to the paper are cleared by the caller in a commit of their own (library.detachPaper).
    },
  };
  return papers;
}
