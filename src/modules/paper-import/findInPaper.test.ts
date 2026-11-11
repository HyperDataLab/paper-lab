import { expect, it } from 'vitest';
import type { Paper } from '@/core/schemas';
import { findInPaper } from './findInPaper';

const paper = {
  paragraphs: [
    {
      id: 'a',
      sectionId: 's',
      order: 0,
      kind: 'body',
      text: '😀 Data sharing, and SHARING again.',
      pageStart: 1,
      textHash: '',
    },
    {
      id: 'c',
      sectionId: 's',
      order: 1,
      kind: 'caption',
      text: 'Figure 1. Sharing.',
      pageStart: 1,
      textHash: '',
    },
  ],
} as unknown as Paper;

it('R14 finds every place a phrase appears in the body text, ignoring case, in code points', () => {
  expect(findInPaper(paper, 'sharing')).toEqual([
    { paragraphId: 'a', start: 7, end: 14 },
    { paragraphId: 'a', start: 20, end: 27 },
  ]);
  // Too short to be a search, and captions are not body text.
  expect(findInPaper(paper, 's')).toEqual([]);
  expect(findInPaper(paper, 'figure')).toEqual([]);
});
