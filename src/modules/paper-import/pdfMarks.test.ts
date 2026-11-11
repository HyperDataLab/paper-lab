import { expect, it } from 'vitest';
import type { Paper } from '@/core/schemas';
import { findNeedle, pdfMarks, pdfNeedle } from './pdfMarks';

const covered = (items: string[], ranges: { item: number; from: number; to: number }[] | null) =>
  ranges?.map((range) => items[range.item]?.slice(range.from, range.to)).join('|') ?? null;

it('R9 a passage is found across several text items of the page', () => {
  const items = ['The model was trained on ', ' two corpora and', ' tested on a third one.'];
  const ranges = findNeedle(items, {
    before: 'model was ',
    text: 'trained on two corpora and tested',
    after: '',
  });
  expect(covered(items, ranges)).toBe('trained on|two corpora and|tested');
});

it('R9 words split by a hyphen at a line end and ligatures still match', () => {
  const items = ['We found a signiﬁcant exam-', 'ple of the effect.'];
  const ranges = findNeedle(items, { before: '', text: 'significant example of the effect', after: '' });
  expect(covered(items, ranges)).toBe('signiﬁcant exam|ple of the effect');
});

it('R9 a short phrase that repeats is found where its paragraph puts it', () => {
  const items = ['In 2020 the rate rose. ', 'Later the rate fell sharply.'];
  const ranges = findNeedle(items, { before: 'Later ', text: 'the rate', after: ' fell sharply' });
  expect(ranges).toEqual([{ item: 1, from: 6, to: 14 }]);
  // Without context a short phrase is never guessed.
  expect(findNeedle(items, { before: 'unrelated', text: 'the rate', after: 'words' })).toBeNull();
});

it('R9 a passage that is not on the page is not found', () => {
  expect(
    findNeedle(['Something else entirely.'], { before: '', text: 'a sentence from another page', after: '' }),
  ).toBeNull();
});

it('R9 a long passage is found by its first and last words', () => {
  const body = 'word '.repeat(120);
  const items = ['Start of the passage ', body, 'end of the passage here. Next sentence.'];
  const ranges = findNeedle(items, {
    before: '',
    text: `Start of the passage ${body}end of the passage here.`,
    after: '',
  });
  expect(ranges?.[0]).toEqual({ item: 0, from: 0, to: 20 });
  expect(ranges?.at(-1)).toEqual({ item: 2, from: 0, to: 24 });
});

it('R9 marks carry their paragraph page and context, and paragraphs without a page are skipped', () => {
  const paper = {
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'Alpha beta gamma delta.',
        pageStart: 4,
        textHash: '',
      },
      {
        id: 'p2',
        sectionId: 'a',
        order: 1,
        kind: 'body',
        text: 'No page here.',
        pageStart: null,
        textHash: '',
      },
    ],
  } as unknown as Paper;
  expect(pdfNeedle(paper, { paragraphId: 'p1', start: 6, end: 10 }, 'x')).toEqual({
    id: 'x',
    page: 4,
    before: 'Alpha ',
    text: 'beta',
    after: ' gamma delta.',
  });
  const marks = pdfMarks(
    paper,
    [
      {
        paragraphId: 'p1',
        start: 0,
        end: 5,
        id: 'm1',
        criterion: 'claim',
        label: 'A claim',
        findingId: 'f1',
        view: 'x',
      },
      {
        paragraphId: 'p2',
        start: 0,
        end: 2,
        id: 'm2',
        criterion: 'claim',
        label: 'B',
        findingId: null,
        view: 'x',
      },
    ],
    (mark) => mark.label,
  );
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ id: 'm1', strong: true, title: 'A claim', criterion: 'claim' });
});
