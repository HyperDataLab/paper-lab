import { describe, expect, it } from 'vitest';
import type { Corpus } from '../schemas';
import { CorpusSchema } from '../schemas';
import {
  MMAT_CATEGORIES,
  MMAT_SCREENING,
  appraisalCsvRows,
  currentAppraisal,
  recordAppraisal,
  type AppraisalInput,
} from './appraisal';
import { newCorpus } from './index';
import { addFromDois } from './intake';
import { recordDecision } from './screening';

const at = (day: number) => `2026-02-${String(day).padStart(2, '0')}T00:00:00.000Z`;
function fixture(): { corpus: Corpus; included: string; screened: string } {
  let corpus = addFromDois(
    newCorpus({
      id: 'mmat',
      kind: 'topic',
      title: 'MMAT review',
      createdAt: at(1),
      protocol: [
        {
          version: 1,
          createdAt: at(1),
          body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] },
        },
      ],
    }),
    '10.1000/a\n10.1000/b',
    { now: at(1) },
  ).corpus;
  const [included, screened] = corpus.members.map((m) => m.memberId) as [string, string];
  for (const [memberId, stage] of [
    [included, 'title-abstract'],
    [included, 'full-text'],
    [screened, 'title-abstract'],
  ] as const) {
    const result = recordDecision(corpus, memberId, { stage, decision: 'include', person: 'An' }, at(2));
    if (!result.ok) throw new Error(result.error);
    corpus = result.corpus;
  }
  return { corpus, included, screened };
}
const yes = { judgement: 'yes' as const };
const full: AppraisalInput = {
  category: 'qualitative',
  appraiser: 'Bình',
  answers: {
    S1: yes,
    S2: yes,
    '1.1': { judgement: 'yes', quote: '  semi-structured interviews  ' },
    '1.2': yes,
    '1.3': { judgement: 'no', note: 'themes asserted' },
    '1.4': { judgement: 'cant_tell' },
    '1.5': yes,
  },
};

describe('C3d MMAT appraisal', () => {
  it('C3d every MMAT category has exactly five criteria, after two screening questions', () => {
    expect(MMAT_SCREENING.map((q) => q.id)).toEqual(['S1', 'S2']);
    expect(MMAT_CATEGORIES).toHaveLength(5);
    for (const [index, category] of MMAT_CATEGORIES.entries()) {
      expect(category.criteria.map((c) => c.id)).toEqual([1, 2, 3, 4, 5].map((n) => `${index + 1}.${n}`));
    }
  });

  it('C3d needs an appraiser, a category, every answer and an included study', () => {
    const { corpus, included, screened } = fixture();
    expect(recordAppraisal(corpus, included, { ...full, appraiser: '  ' }, at(3))).toEqual({
      ok: false,
      error: 'appraiser-required',
    });
    expect(recordAppraisal(corpus, included, { ...full, category: '' }, at(3))).toMatchObject({
      error: 'category-required',
    });
    const { '1.5': _skip, ...partial } = full.answers;
    void _skip;
    expect(recordAppraisal(corpus, included, { ...full, answers: partial }, at(3))).toMatchObject({
      error: 'answers-incomplete',
    });
    expect(recordAppraisal(corpus, screened, full, at(3))).toMatchObject({ error: 'not-included' });
    // A screening question answered No makes the five criteria optional, as MMAT allows.
    expect(
      recordAppraisal(corpus, included, { ...full, answers: { S1: yes, S2: { judgement: 'no' } } }, at(3)).ok,
    ).toBe(true);
  });

  it('C3d stores the category and answers, reads the latest set and counts without a total score', () => {
    const { corpus, included } = fixture();
    const first = recordAppraisal(corpus, included, full, at(3));
    if (!first.ok) throw new Error(first.error);
    const second = recordAppraisal(
      first.corpus,
      included,
      { category: 'mixed-methods', appraiser: 'Chi', answers: { S1: yes, S2: { judgement: 'cant_tell' } } },
      at(4),
    );
    if (!second.ok) throw new Error(second.error);
    expect(() => CorpusSchema.parse(second.corpus)).not.toThrow();
    const member = first.corpus.members.find((m) => m.memberId === included);
    expect(member?.appraisal[0]).toEqual({
      tool: 'MMAT-2018',
      domain: 'category',
      judgement: 'qualitative',
      appraiser: 'Bình',
      at: at(3),
    });
    expect(member?.appraisal.find((e) => e.domain === '1.1')?.quote).toBe('semi-structured interviews');
    const current = member && currentAppraisal(member);
    expect(current?.counts).toEqual({ yes: 3, no: 1, cant_tell: 1 });
    const latest = second.corpus.members.find((m) => m.memberId === included);
    expect(latest && currentAppraisal(latest)).toMatchObject({
      category: { id: 'mixed-methods' },
      appraiser: 'Chi',
      counts: { yes: 0, no: 0, cant_tell: 0 },
    });
    expect(latest?.appraisal).toHaveLength(8 + 3);
  });

  it('C3d CSV has one row per answer and no score column', () => {
    const { corpus, included } = fixture();
    const result = recordAppraisal(corpus, included, full, at(3));
    if (!result.ok) throw new Error(result.error);
    const rows = appraisalCsvRows(result.corpus);
    expect(rows[0]).toEqual([
      'member',
      'title',
      'tool',
      'category',
      'item',
      'item short form',
      'judgement',
      'quote',
      'note',
      'appraiser',
      'at',
    ]);
    expect(rows[0]?.some((cell) => /score/iu.test(cell))).toBe(false);
    expect(rows).toHaveLength(1 + 7);
    expect(rows[5]).toEqual(
      expect.arrayContaining(['qualitative', '1.3', 'findings derived from data', 'no', 'themes asserted']),
    );
  });
});
