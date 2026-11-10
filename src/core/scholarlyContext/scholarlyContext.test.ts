import { describe, expect, it } from 'vitest';
import type { Paper } from '../schemas';
import {
  doisToCheck,
  mapWorkStatuses,
  paperDoi,
  referenceList,
  referenceStats,
  retractedWorks,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const reference = (id: string, order: number, text: string) => ({
  id,
  sectionId: 'r',
  order,
  text,
  kind: 'reference' as const,
  textHash: id,
  pageStart: 9,
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 9, sha256: 'x' },
  sections: [
    { id: 'i', heading: 'Intro', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 9 },
  ],
  paragraphs: [
    {
      id: 'p',
      sectionId: 'i',
      order: 0,
      text: 'See https://doi.org/10.1000/SELF.',
      kind: 'body',
      textHash: 'p',
      pageStart: 1,
    },
    {
      id: 'q',
      sectionId: 'i',
      order: 1,
      text: 'Later 10.1000/later.',
      kind: 'body',
      textHash: 'q',
      pageStart: 2,
    },
    reference('r1', 2, 'Smith, A. A study. Journal 12, 2024. doi:10.1000/one.'),
    reference('r2', 3, 'Lee, B. Old work. Press, 1999.'),
    reference('r3', 4, 'Kim, C. Preprint. arXiv:1909.01234, 2021.'),
    reference('r4', 5, 'Tran, D. Undated manuscript. https://example.org/2003/page'),
    reference('r5', 6, 'Vo, E. Odd. 10.1000/a,b 2020.'),
  ],
};
const now = new Date('2026-06-01T00:00:00Z');

describe('D1 scholarly context', () => {
  it('reads a year and DOI per reference, ignoring digits inside identifiers and links', () => {
    const items = referenceList(paper, now);
    expect(items.map((item) => item.year)).toEqual([2024, 1999, 2021, null, 2020]);
    expect(items[0]?.doi).toBe('10.1000/one');
    expect(items[0]?.location?.paragraphId).toBe('r1');
  });
  it('joins an entry the PDF broke across lines, even when the next line looks like a new entry', () => {
    const items = referenceList(
      {
        ...paper,
        paragraphs: [
          reference('a', 0, 'Abdul, M., White, I.,'),
          reference('b', 1, 'Leibo, J., and Shah, N. A title. Journal, 2024.'),
          reference('c', 2, 'Ng, A. Other. Press, 2010.'),
        ],
      },
      now,
    );
    expect(items.map((item) => item.year)).toEqual([2024, 2010]);
    expect(items[0]?.location?.paragraphId).toBe('a');
  });
  it('ignores impossible future years', () => {
    const items = referenceList(
      { ...paper, paragraphs: [reference('r', 0, 'Ng, A. Title. 2090, 2019.')] },
      now,
    );
    expect(items[0]?.year).toBe(2019);
  });
  it('measures recency against the newest cited year and says how many have no year', () => {
    const stats = referenceStats(referenceList(paper, now));
    expect(stats).toMatchObject({ total: 5, withYear: 4, withDoi: 2, newest: 2024, median: 2020, recent: 3 });
    expect(stats.buckets).toEqual([
      { from: 2020, to: 2024, count: 3 },
      { from: 1995, to: 1999, count: 1 },
    ]);
  });
  it('copes with a paper that has no references', () => {
    const stats = referenceStats([]);
    expect(stats).toMatchObject({ total: 0, newest: null, median: null, recent: 0, buckets: [] });
  });
  it('takes the paper DOI from the first page only', () => {
    expect(paperDoi(paper)).toBe('10.1000/self');
    expect(paperDoi({ ...paper, paragraphs: paper.paragraphs.slice(1) })).toBeNull();
  });
  it('sends each DOI once and leaves out those the filter would misread', () => {
    const items = referenceList(paper, now);
    const doubled = [...items, { text: '', year: null, doi: '10.1000/one', location: null }];
    expect(doisToCheck(paper, doubled)).toEqual(['10.1000/self', '10.1000/one']);
  });
  it('reads OpenAlex records and separates the paper from what it cites', () => {
    const statuses = mapWorkStatuses({
      results: [
        { doi: 'https://doi.org/10.1000/SELF', title: 'Self', publication_year: 2020, is_retracted: true },
        { doi: 'https://doi.org/10.1000/one', title: null, is_retracted: true },
        { doi: 'https://doi.org/10.1000/ok', title: 'Fine', publication_year: 2021, is_retracted: false },
        { doi: null, is_retracted: true },
      ],
    });
    expect(statuses).toHaveLength(3);
    expect(retractedWorks(statuses, '10.1000/self')).toEqual([
      { doi: '10.1000/self', title: 'Self', year: 2020, isPaper: true },
      { doi: '10.1000/one', title: null, year: null, isPaper: false },
    ]);
    expect(mapWorkStatuses(null)).toEqual([]);
    expect(mapWorkStatuses({ results: 'x' })).toEqual([]);
  });
});
