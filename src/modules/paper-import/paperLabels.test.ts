import { expect, it } from 'vitest';
import type { Paper } from '@/core/schemas';
import { placeLabel, placeOf } from './paperLabels';

const paper = {
  sections: [
    {
      id: 'a',
      heading: 'Abstract. Decentralized federated learning (DFL) has emerged as a promising paradigm',
      role: 'abstract',
      level: 1,
      pageStart: 1,
    },
    {
      id: 'x',
      heading: 'Carbon accounting with CodeCarbon on edge nodes',
      role: 'other',
      level: 2,
      pageStart: 4,
    },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 'a', order: 0, kind: 'body', text: 'A.', pageStart: 1, textHash: '' },
    { id: 'p2', sectionId: 'x', order: 1, kind: 'body', text: 'B.', pageStart: null, textHash: '' },
  ],
} as unknown as Paper;

it('a place is named by the kind of its section and its page, never by a long parsed heading', () => {
  expect(placeOf(paper, 'p1')).toMatchObject({ role: 'abstract', label: 'Abstract', page: 1 });
  expect(placeLabel(paper, 'p1')).toBe('Abstract · Tr. 1');
  // A section of no known kind keeps a short form of its heading.
  expect(placeOf(paper, 'p2')?.label).toBe('Carbon accounting with…');
  expect(placeLabel(paper, 'missing')).toBe('Không rõ vị trí');
});
