import { describe, expect, it } from 'vitest';
import { buildPaperReviewPrompt, PaperReviewOutputSchema, type PaperReviewOutput } from '../prompts';
import type { Paper } from '../schemas/paper';
import {
  agreement,
  anchorReview,
  anchoringRate,
  mergePanel,
  panelSimilarity,
  reviewRevealed,
  templatePhrases,
} from './index';

const paper: Paper = {
  schemaVersion: 1,
  id: 'a',
  title: 'Test',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  source: { kind: 'text', fileName: 'test', pageCount: null, sha256: 'x' },
  sections: [
    { id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
    { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: null },
  ],
  paragraphs: [
    {
      id: 'p',
      sectionId: 's',
      order: 0,
      text: '😀 “Some   important methods” are described here.',
      kind: 'body',
      pageStart: null,
      textHash: 'x',
    },
    {
      id: 'ref',
      sectionId: 'r',
      order: 1,
      text: 'Reference',
      kind: 'reference',
      pageStart: null,
      textHash: 'y',
    },
  ],
};
const output: PaperReviewOutput = {
  lens: 'methods_skeptic',
  summary: '',
  points: [
    {
      kind: 'weakness',
      dimension: 'soundness',
      paragraphId: 'p',
      quote: '"Some important methods"',
      point: 'phương pháp cần mô tả rõ hơn',
      rationale: 'thiếu thông tin',
      severity: 'moderate',
      confidence: 0.8,
    },
  ],
  unanchored: [],
  cannotJudge: [],
};
describe('P5 review panel', () => {
  it('P5 builds the specified prompt and guards input size', () => {
    const prompt = buildPaperReviewPrompt(paper, {
      lens: 'methods_skeptic',
      sectionIds: ['s'],
      checkSummary: 'checked',
    });
    expect(prompt.system).toContain('do not give an overall rating');
    expect(prompt.system).toContain('5–40 words');
    expect(prompt.system).toContain('Sections not provided: r | references | References');
    expect(prompt.system).toContain('checked');
    expect(prompt.user).toContain('p | ');
    expect(PaperReviewOutputSchema.shape).not.toHaveProperty('rating');
    expect(() =>
      buildPaperReviewPrompt(
        { ...paper, paragraphs: [{ ...paper.paragraphs[0]!, text: 'a'.repeat(60001) }] },
        { lens: 'methods_skeptic', sectionIds: ['s'], checkSummary: '' },
      ),
    ).toThrow();
  });
  it('P5 anchors normalised quotations and rejects non-body and absent quotations', () => {
    const review = anchorReview(
      {
        ...output,
        points: [
          ...output.points,
          { ...output.points[0]!, paragraphId: 'ref' },
          { ...output.points[0]!, quote: 'missing' },
        ],
      },
      paper,
      ['s', 'r'],
    );
    expect(review.points[0]?.anchor).toEqual({ paragraphId: 'p', start: 2, end: 28 });
    expect(review.unanchored).toHaveLength(2);
    expect(anchoringRate([review])).toEqual({ anchored: 1, total: 3, rate: 1 / 3 });
  });
  it('P5 merges lenses deterministically and compares similarity and human notes', () => {
    const a = anchorReview(output, paper, ['s']);
    const b = anchorReview({ ...output, lens: 'clarity_editor' }, paper, ['s']);
    const merged = mergePanel([a, b]);
    expect(merged).toHaveLength(1);
    expect(mergePanel([b, a])[0]?.id).toBe(merged[0]?.id);
    expect(panelSimilarity([a, b]).similarPairs).toHaveLength(1);
    const notes = { paperId: 'a', text: 'phương pháp cần mô tả rõ hơn', writtenAt: 'now', revealedAt: 'now' };
    expect(agreement(merged, notes).matching).toBe(1);
    expect(reviewRevealed(notes)).toBe(true);
    expect(reviewRevealed(null)).toBe(false);
  });
  it('P5 flags phrases only after three other papers and stores hashes', async () => {
    const review = anchorReview(output, paper, ['s']);
    const initial = await templatePhrases([review], 'a', []);
    expect(initial.flags).toHaveLength(0);
    const previous = initial.ngrams.flatMap(({ hash }) =>
      ['a', 'b', 'c', 'd'].map((paperId) => ({ hash, paperId })),
    );
    const result = await templatePhrases([review], 'a', previous);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.ngrams[0]).not.toHaveProperty('phrase');
  });
});
