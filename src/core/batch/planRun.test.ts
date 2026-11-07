import { describe, expect, it } from 'vitest';
import type { Paper } from '../schemas';
import { planRun } from './planRun';

describe('P2 planRun', () => {
  it('skips non-body paragraphs and estimates syntax in section batches', () => {
    const paper: Paper = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      title: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
      sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null }],
      paragraphs: [
        {
          id: 'p1',
          sectionId: 's',
          order: 0,
          text: Array(25).fill('This works.').join(' '),
          kind: 'body',
          textHash: 'a',
          pageStart: null,
        },
        {
          id: 'p2',
          sectionId: 's',
          order: 1,
          text: Array(20).fill('This works.').join(' '),
          kind: 'body',
          textHash: 'b',
          pageStart: null,
        },
        {
          id: 'p3',
          sectionId: 's',
          order: 2,
          text: 'Figure.',
          kind: 'caption',
          textHash: 'c',
          pageStart: null,
        },
      ],
    };
    const plan = planRun(paper, { sectionIds: ['s'], steps: ['syntax', 'judge'], budget: 3 });
    expect(plan.calls).toEqual({ syntax: 2, judge: 2, structure: 0, score: 0 });
    expect(plan.total).toBe(4);
    expect(plan.withinBudget).toBe(false);
    expect(plan.skipped).toEqual([{ paragraphId: 'p3', reason: 'caption' }]);
  });
});
