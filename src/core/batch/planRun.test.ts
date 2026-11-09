import { describe, expect, it } from 'vitest';
import type { Paper } from '../schemas';
import { groupSyntaxBatches, planRun } from './planRun';

describe('P2 planRun', () => {
  it('skips non-body paragraphs and gives a paragraph over the sentence limit its own requests', () => {
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
          text: Array(85).fill('This works.').join(' '),
          kind: 'body',
          textHash: 'a',
          pageStart: null,
        },
        {
          id: 'p2',
          sectionId: 's',
          order: 1,
          text: 'This works.',
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
    expect(plan.calls).toEqual({ syntax: 4, judge: 2, structure: 0, score: 0 });
    expect(plan.total).toBe(6);
    expect(plan.withinBudget).toBe(false);
    expect(plan.skipped).toEqual([{ paragraphId: 'p3', reason: 'caption' }]);
  });
  it('P2 shares syntax requests within a section up to 40 sentences but never across sections', () => {
    const body = (id: string, sectionId: string, count: number, order: number) => ({
      id,
      sectionId,
      order,
      text: Array(count).fill('This works.').join(' '),
      kind: 'body' as const,
      textHash: id,
      pageStart: null,
    });
    const paper: Paper = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      title: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
      sections: [
        { id: 'a', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
        { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: null },
      ],
      paragraphs: [
        body('a1', 'a', 20, 0),
        body('a2', 'a', 20, 1),
        body('a3', 'a', 1, 2),
        body('b1', 'b', 3, 3),
      ],
    };
    const plan = planRun(paper, { sectionIds: ['a', 'b'], steps: ['syntax'], budget: 3 });
    expect(plan.calls.syntax).toBe(3);
    expect(plan.withinBudget).toBe(true);
    expect(groupSyntaxBatches([20, 20, 1], (size) => size)).toEqual([[20, 20], [1]]);
    expect(groupSyntaxBatches([], (size: number) => size)).toEqual([]);
  });
});
