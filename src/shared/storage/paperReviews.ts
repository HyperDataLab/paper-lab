import {
  AuditEventSchema,
  PaperReviewRunSchema,
  PaperReviewsRecordSchema,
  ReviewNgramSchema,
  type AuditEvent,
  type Paper,
  type PaperReviewRun,
  type PaperReviewsRecord,
  type ReviewDecision,
} from '@/core/schemas';
import {
  agreement,
  anchorReview,
  anchoringRate,
  mergePanel,
  panelSimilarity,
  templatePhrases,
  visibleReviewRuns,
} from '@/core/reviewPanel';
import type { ParagraphDb } from './db';

export async function rebuildReviewRecord(
  paper: Paper,
  input: PaperReviewsRecord,
  previous: { hash: string; paperId: string }[],
) {
  const parsed = PaperReviewsRecordSchema.parse(input);
  if (parsed.paperId !== paper.id) throw new Error('Review paper mismatch');
  const allNgrams = new Map<string, { hash: string; paperId: string }>();
  const legacyIds = new Map<string, Set<string>>();
  const runs: PaperReviewRun[] = [];
  for (const run of parsed.runs) {
    const reviews = run.reviews.map((review) => anchorReview(review, paper, run.sectionIds));
    const merged = mergePanel(reviews);
    for (const point of merged) {
      const legacy = JSON.stringify([
        point.lenses,
        point.anchor.paragraphId,
        point.anchor.start,
        point.anchor.end,
      ]);
      const ids = legacyIds.get(legacy) ?? new Set<string>();
      ids.add(point.id);
      legacyIds.set(legacy, ids);
    }
    const templates = await templatePhrases(reviews, paper.id, previous);
    for (const item of templates.ngrams) allNgrams.set(item.hash, ReviewNgramSchema.parse(item));
    runs.push(
      PaperReviewRunSchema.parse({
        ...run,
        reviews,
        merged,
        metrics: {
          anchoring: anchoringRate(reviews),
          similarity: panelSimilarity(reviews),
          templates: templates.flags,
          agreement: agreement(merged, parsed.humanNotes),
        },
      }),
    );
  }
  const decisions = parsed.decisions.map((decision) => {
    const ids = legacyIds.get(decision.pointId);
    return ids?.size === 1 ? { ...decision, pointId: [...ids][0] } : decision;
  });
  return {
    record: PaperReviewsRecordSchema.parse({ ...parsed, runs, decisions }),
    ngrams: [...allNgrams.values()],
  };
}

export function createPaperReviewsRepository(
  db: ParagraphDb,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
) {
  async function get(paperId: string) {
    const row = await db.paperReviews.get(paperId);
    return row ? PaperReviewsRecordSchema.parse(row) : undefined;
  }
  const nextTime = (current?: PaperReviewsRecord) =>
    new Date(Math.max(Date.parse(now()), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
  const empty = (paperId: string, updatedAt: string): PaperReviewsRecord => ({
    schemaVersion: 1,
    paperId,
    updatedAt,
    runs: [],
    humanNotes: null,
    decisions: [],
  });
  return {
    get,
    async getVisible(paperId: string) {
      const record = await get(paperId);
      return record ? { ...record, runs: visibleReviewRuns(record.humanNotes, record.runs) } : undefined;
    },
    async saveRun(paperId: string, input: PaperReviewRun) {
      const paper = await db.papers.get(paperId);
      if (!paper) throw new Error('Paper not found');
      const current = await get(paperId);
      const at = nextTime(current);
      const run = PaperReviewRunSchema.parse(input);
      if (current?.runs.some((item) => item.id === run.id)) throw new Error('Review run already exists');
      const record = {
        ...(current ?? empty(paperId, at)),
        updatedAt: at,
        runs: [...(current?.runs ?? []), run],
      };
      const rebuilt = await rebuildReviewRecord(paper, record, await db.reviewNgrams.toArray());
      return db.transaction('rw', [db.papers, db.paperReviews, db.reviewNgrams, db.auditEvents], async () => {
        const livePaper = await db.papers.get(paperId);
        if (!livePaper || JSON.stringify(livePaper.paragraphs) !== JSON.stringify(paper.paragraphs))
          throw new Error('Paper changed');
        if ((await get(paperId))?.updatedAt !== current?.updatedAt) throw new Error('Review changed; retry');
        await db.paperReviews.put(rebuilt.record);
        await db.reviewNgrams.where('paperId').equals(paperId).delete();
        await db.reviewNgrams.bulkPut(rebuilt.ngrams);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'run_review', 'model'),
            at,
            after: { runId: run.id },
          }),
        );
        return rebuilt.record;
      });
    },
    async saveNotes(paperId: string, text: string, skip = false) {
      return db.transaction('rw', [db.papers, db.paperReviews, db.auditEvents], async () => {
        if (!(await db.papers.get(paperId))) throw new Error('Paper not found');
        const current = await get(paperId);
        const at = nextTime(current);
        const humanNotes = { paperId, text: skip ? '' : text, writtenAt: at, revealedAt: at };
        const value = PaperReviewsRecordSchema.parse({
          ...(current ?? empty(paperId, at)),
          updatedAt: at,
          humanNotes,
          runs: (current?.runs ?? []).map((run) => ({
            ...run,
            metrics: { ...run.metrics, agreement: agreement(run.merged, humanNotes) },
          })),
        });
        await db.paperReviews.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'save_notes', 'human'),
            at,
            before: current?.humanNotes ?? null,
            after: humanNotes,
            note: skip ? 'skipped' : null,
          }),
        );
        return value;
      });
    },
    async review(
      paperId: string,
      pointId: string,
      status: ReviewDecision['status'] | 'candidate',
      note = '',
    ) {
      return db.transaction('rw', [db.paperReviews, db.auditEvents], async () => {
        const current = await get(paperId);
        if (
          !current?.humanNotes?.revealedAt ||
          !current.runs.at(-1)?.merged.some((point) => point.id === pointId)
        )
          throw new Error('Review point not available');
        const at = nextTime(current);
        const before = current.decisions.find((d) => d.pointId === pointId) ?? null;
        const decisions = current.decisions.filter((d) => d.pointId !== pointId);
        const after = status === 'candidate' ? null : { pointId, status, note, at };
        if (after) decisions.push(after);
        const value = PaperReviewsRecordSchema.parse({ ...current, updatedAt: at, decisions });
        await db.paperReviews.put(value);
        await db.auditEvents.add(
          AuditEventSchema.parse({
            ...makeAudit(paperId, 'review_point', 'human'),
            at,
            issueId: pointId,
            before,
            after,
            note,
          }),
        );
        return value;
      });
    },
  };
}
