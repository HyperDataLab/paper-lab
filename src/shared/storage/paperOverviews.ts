import {
  PaperSchema,
  PaperOverviewRecordSchema,
  AuditEventSchema,
  type PaperOverviewRecord,
} from '@/core/schemas';
import { aggregatePaper, transitionStatus } from '@/core/paperOverview';
import { appendAudit, readAnalyses, type StorageDeps } from './storageShared';
import type { DocReader, DocStore } from './docStore';
export function createPaperOverviewsRepository(store: DocStore, deps: StorageDeps) {
  const { now, makeAudit } = deps;
  async function get(reader: DocReader, paperId: string) {
    const [row, stored, { values: paperAnalyses }] = await Promise.all([
      reader.get('papers', paperId),
      reader.get('paperOverviews', paperId),
      readAnalyses(reader, paperId),
    ]);
    if (!row) return undefined;
    const paper = PaperSchema.parse(row.doc);
    const saved = stored ? PaperOverviewRecordSchema.parse(stored.doc).transitions : null;
    return PaperOverviewRecordSchema.parse({
      schemaVersion: 1,
      paperId,
      overview: aggregatePaper(paper, paperAnalyses),
      transitions: saved ? transitionStatus(paper, paperAnalyses, saved) : null,
    });
  }
  const paperOverviews = {
    get: (paperId: string) => get(store, paperId),
    async save(input: PaperOverviewRecord) {
      const parsed = PaperOverviewRecordSchema.parse(input);
      return store.unitOfWork(
        async (tx) => {
          const current = await get(tx, parsed.paperId);
          if (!current) throw new Error('Paper not found');
          const value = PaperOverviewRecordSchema.parse({ ...parsed, overview: current.overview });
          await tx.put('paperOverviews', value.paperId, value);
          return value;
        },
        ['paperOverviews', 'papers', 'analyses'],
      );
    },
    async reviewTransition(
      paperId: string,
      findingId: string,
      status: 'confirmed_by_human' | 'dismissed_by_human' | 'confirmed_by_model' | 'candidate',
    ) {
      return store.unitOfWork(
        async (tx) => {
          const current = await get(tx, paperId);
          const finding = current?.transitions?.findings.find((item) => item.id === findingId);
          if (!current || !current.transitions || !finding) throw new Error('Transition finding not found');
          if (finding.status === status) return current;
          const reviewedAt = new Date(
            Math.max(
              Date.parse(now()),
              Date.parse(current.transitions.updatedAt) + 1,
              current.transitions.reviewedAt ? Date.parse(current.transitions.reviewedAt) + 1 : 0,
            ),
          ).toISOString();
          const value = PaperOverviewRecordSchema.parse({
            ...current,
            transitions: {
              ...current.transitions,
              reviewedAt,
              findings: current.transitions.findings.map((item) =>
                item.id === findingId ? { ...item, status } : item,
              ),
            },
          });
          await tx.put('paperOverviews', value.paperId, value);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'review_transition', 'human'),
              at: reviewedAt,
              issueId: findingId,
              before: { status: finding.status },
              after: { status },
            }),
          );
          return value;
        },
        ['paperOverviews', 'papers', 'analyses'],
      );
    },
  };
  return paperOverviews;
}
