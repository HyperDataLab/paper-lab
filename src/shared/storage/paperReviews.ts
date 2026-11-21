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
import type { DocReader, DocStore } from './docStore';
import { appendAudit, requirePaper } from './storageShared';
import { readReviewNgrams, replaceReviewNgrams } from './reviewNgrams';
import { PaperSchema } from '@/core/schemas';

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
  store: DocStore,
  now: () => string,
  makeAudit: (id: string, action: AuditEvent['action'], actor: AuditEvent['actor']) => AuditEvent,
  latestAuditAt: (id: string) => Promise<string | undefined>,
) {
  async function read(reader: DocReader, paperId: string) {
    const row = await reader.get('paperReviews', paperId);
    return row ? PaperReviewsRecordSchema.parse(row.doc) : undefined;
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
  const get = (paperId: string) => read(store, paperId);
  return {
    get,
    async getVisible(paperId: string) {
      const record = await get(paperId);
      return record ? { ...record, runs: visibleReviewRuns(record.humanNotes, record.runs) } : undefined;
    },
    async saveRun(paperId: string, input: PaperReviewRun) {
      const paper = PaperSchema.parse(await requirePaper(store, paperId));
      const current = await get(paperId);
      const at = nextTime(current);
      const run = PaperReviewRunSchema.parse(input);
      if (current?.runs.some((item) => item.id === run.id)) throw new Error('Review run already exists');
      const record = {
        ...(current ?? empty(paperId, at)),
        updatedAt: at,
        runs: [...(current?.runs ?? []), run],
      };
      const rebuilt = await rebuildReviewRecord(paper, record, await readReviewNgrams(store));
      return store.unitOfWork(
        async (tx) => {
          const livePaper = PaperSchema.parse(await requirePaper(tx, paperId));
          if (JSON.stringify(livePaper.paragraphs) !== JSON.stringify(paper.paragraphs))
            throw new Error('Paper changed');
          if ((await read(tx, paperId))?.updatedAt !== current?.updatedAt)
            throw new Error('Review changed; retry');
          await tx.put('paperReviews', paperId, rebuilt.record);
          await replaceReviewNgrams(tx, paperId, rebuilt.ngrams);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'run_review', 'model'),
              at,
              after: { runId: run.id },
            }),
          );
          return rebuilt.record;
        },
        ['papers', 'paperReviews', 'reviewNgrams'],
      );
    },
    async saveNotes(paperId: string, text: string, skip = false) {
      const latestAudit = await latestAuditAt(paperId);
      return store.unitOfWork(
        async (tx) => {
          await requirePaper(tx, paperId);
          const current = await read(tx, paperId);
          const at = new Date(
            Math.max(
              Date.parse(nextTime(current)),
              Date.parse(latestAudit ?? '1970-01-01T00:00:00.000Z') + 1,
            ),
          ).toISOString();
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
          await tx.put('paperReviews', paperId, value);
          await appendAudit(
            tx,
            AuditEventSchema.parse({
              ...makeAudit(paperId, 'save_notes', 'human'),
              at,
              before: current?.humanNotes ?? null,
              after: humanNotes,
              note: skip ? 'skipped' : null,
            }),
          );
          return value;
        },
        ['papers', 'paperReviews'],
      );
    },
    async review(
      paperId: string,
      pointId: string,
      status: ReviewDecision['status'] | 'candidate',
      note = '',
    ) {
      const latestAudit = await latestAuditAt(paperId);
      return store.unitOfWork(
        async (tx) => {
          const current = await read(tx, paperId);
          if (
            !current?.humanNotes?.revealedAt ||
            !current.runs.at(-1)?.merged.some((point) => point.id === pointId)
          )
            throw new Error('Review point not available');
          const at = new Date(
            Math.max(
              Date.parse(nextTime(current)),
              Date.parse(latestAudit ?? '1970-01-01T00:00:00.000Z') + 1,
            ),
          ).toISOString();
          const before = current.decisions.find((d) => d.pointId === pointId) ?? null;
          const decisions = current.decisions.filter((d) => d.pointId !== pointId);
          const after = status === 'candidate' ? null : { pointId, status, note, at };
          if (after) decisions.push(after);
          const value = PaperReviewsRecordSchema.parse({ ...current, updatedAt: at, decisions });
          await tx.put('paperReviews', paperId, value);
          await appendAudit(
            tx,
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
        },
        ['paperReviews'],
      );
    },
  };
}
