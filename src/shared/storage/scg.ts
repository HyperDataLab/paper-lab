import { setScgReview, type ScgReviewTarget } from '@/core/scg';
import { ScgPaperRunSchema, type ScgPaperRun, type ScgReview } from '@/core/schemas';
import type { ParagraphDb } from './db';

/** One SCG run per paper, keyed by the PaperLab paper id. Every read and write is validated. */
export function createScgRepository(db: ParagraphDb, clock = () => new Date()) {
  const parse = (value: unknown) => ScgPaperRunSchema.parse(value);
  return {
    async get(paperId: string) {
      const value = await db.scgRuns.get(paperId);
      return value ? parse(value) : undefined;
    },
    async save(input: ScgPaperRun) {
      const value = parse(input);
      await db.scgRuns.put(value);
      return value;
    },
    /** Every stored run: the lab graph that alignment and the corpus view read. */
    async list() {
      return (await db.scgRuns.toArray()).map(parse);
    },
    async listByPapers(paperIds: string[]) {
      return (await db.scgRuns.bulkGet(paperIds)).filter((v) => v !== undefined).map(parse);
    },
    async setReview(paperId: string, target: ScgReviewTarget, review: ScgReview) {
      return db.transaction('rw', db.scgRuns, async () => {
        const current = await db.scgRuns.get(paperId);
        if (!current) return undefined;
        const value = parse({
          ...setScgReview(parse(current), target, review),
          updatedAt: clock().toISOString(),
        });
        await db.scgRuns.put(value);
        return value;
      });
    },
  };
}
