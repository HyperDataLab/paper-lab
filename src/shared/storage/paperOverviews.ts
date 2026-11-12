import { PaperOverviewRecordSchema, AuditEventSchema, type PaperOverviewRecord } from '@/core/schemas';
import { aggregatePaper, transitionStatus } from '@/core/paperOverview';
import type { StorageDeps } from './storageShared';
import type { createAnalysesRepository } from './analyses';
import type { createPapersRepository } from './papers';
import type { ParagraphDb } from './db';
export function createPaperOverviewsRepository(
  db: ParagraphDb,
  deps: StorageDeps,
  analyses: ReturnType<typeof createAnalysesRepository>,
  papers: ReturnType<typeof createPapersRepository>,
) {
  const { now, makeAudit } = deps;
  const paperOverviews = {
    async get(paperId: string) {
      const paper = await papers.get(paperId);
      if (!paper) return undefined;
      const stored = await db.paperOverviews.get(paperId);
      const saved = stored ? PaperOverviewRecordSchema.parse(stored).transitions : null;
      const paperAnalyses = await analyses.listByPaper(paperId);
      return PaperOverviewRecordSchema.parse({
        schemaVersion: 1,
        paperId,
        overview: aggregatePaper(paper, paperAnalyses),
        transitions: saved ? transitionStatus(paper, paperAnalyses, saved) : null,
      });
    },
    async save(input: PaperOverviewRecord) {
      const parsed = PaperOverviewRecordSchema.parse(input);
      const current = await paperOverviews.get(parsed.paperId);
      if (!current) throw new Error('Paper not found');
      const value = PaperOverviewRecordSchema.parse({ ...parsed, overview: current.overview });
      await db.paperOverviews.put(value);
      return value;
    },
    async reviewTransition(
      paperId: string,
      findingId: string,
      status: 'confirmed_by_human' | 'dismissed_by_human' | 'confirmed_by_model' | 'candidate',
    ) {
      return db.transaction('rw', db.paperOverviews, db.papers, db.analyses, db.auditEvents, async () => {
        const current = await paperOverviews.get(paperId);
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
        await db.paperOverviews.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_transition', 'human'),
            at: reviewedAt,
            issueId: findingId,
            before: { status: finding.status },
            after: { status },
          }),
        );
        return value;
      });
    },
  };
  return paperOverviews;
}
