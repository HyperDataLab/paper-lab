import { setScgReview, type ScgReviewTarget } from '@/core/scg';
import { ScgPaperRunSchema, type ScgPaperRun, type ScgReview } from '@/core/schemas';
import type { DocStore } from './docStore';

/** One SCG run per paper, keyed by the PaperLab paper id. Every read and write is validated. */
export function createScgRepository(store: DocStore, clock = () => new Date()) {
  const parse = (value: unknown) => ScgPaperRunSchema.parse(value);
  return {
    async get(paperId: string) {
      const row = await store.get('scgRuns', paperId);
      return row ? parse(row.doc) : undefined;
    },
    async save(input: ScgPaperRun) {
      const value = parse(input);
      await store.put('scgRuns', value.paperId, value);
      return value;
    },
    /** Every stored run: the lab graph that alignment and the corpus view read. */
    async list() {
      return (await store.query('scgRuns')).map((row) => parse(row.doc));
    },
    async listByPapers(paperIds: string[]) {
      return (await store.getMany('scgRuns', paperIds)).flatMap((row) => (row ? [parse(row.doc)] : []));
    },
    async setReview(paperId: string, target: ScgReviewTarget, review: ScgReview) {
      return store.unitOfWork(async (tx) => {
        const current = await tx.get('scgRuns', paperId);
        if (!current) return undefined;
        const value = parse({
          ...setScgReview(parse(current.doc), target, review),
          updatedAt: clock().toISOString(),
        });
        await tx.put('scgRuns', paperId, value);
        return value;
      });
    },
  };
}
