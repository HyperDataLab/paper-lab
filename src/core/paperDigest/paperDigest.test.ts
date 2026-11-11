import { expect, it } from 'vitest';
import type { Paper } from '../schemas';
import { digestInput, verifyDigest } from '.';

const at = '2026-01-01T00:00:00.000Z';
const para = (id: string, sectionId: string, text: string, page: number | null = 1) => ({
  id,
  sectionId,
  order: 0,
  kind: 'body' as const,
  text,
  pageStart: page,
  textHash: id,
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000e1',
  title: 'Synthetic',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: '', pageCount: 3, sha256: '' },
  sections: [
    { id: 't', heading: 'Title', role: 'title', level: 1, pageStart: 1 },
    { id: 'i', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'r', heading: 'Results', role: 'results', level: 1, pageStart: 2 },
    { id: 'x', heading: 'References', role: 'references', level: 1, pageStart: 3 },
  ],
  paragraphs: [
    para('t1', 't', 'A synthetic title.'),
    para('i1', 'i', 'Sharing data may help other researchers.'),
    para('r1', 'r', 'Trials that shared data received 69% more citations (p = 0.006).', 2),
    para('r2', 'r', 'Smaller journals showed the same pattern.', 2),
    para('x1', 'x', '[1] A reference.', 3),
  ],
};

it('R12 the summary reads the body in the paper order and sections, without title or references', () => {
  const input = digestInput(paper);
  expect(input.sections.map((section) => [section.heading, section.paragraphs.map((p) => p.id)])).toEqual([
    ['Introduction', ['i1']],
    ['Results', ['r1', 'r2']],
  ]);
  expect(input).toMatchObject({ read: 3, total: 3 });
});

it('R12 every part keeps only sources that exist, and numbers must be in the paragraphs it cites', () => {
  const paragraphs = digestInput(paper).sections.flatMap((section) => section.paragraphs);
  const result = verifyDigest(
    {
      headline: ' Sharing data is linked with more citations. ',
      overview: { text: 'Shared trials got 69% more citations.', refs: ['r1', 'nope'] },
      sections: [
        {
          heading: 'Results',
          blocks: [
            {
              text: 'Two findings stand out.',
              refs: ['zz'],
              items: [
                { lead: 'Citations', text: 'up by 85% overall', refs: ['r1'] },
                { lead: null, text: 'Smaller journals too.', refs: ['r2'] },
                { lead: 'Empty', text: '  ', refs: ['r2'] },
              ],
            },
          ],
        },
        { heading: 'Nothing', blocks: [{ text: ' ', refs: [], items: [] }] },
      ],
    },
    paragraphs,
  );
  expect(result.headline).toBe('Sharing data is linked with more citations.');
  expect(result.overview).toEqual({
    text: 'Shared trials got 69% more citations.',
    sources: [{ paragraphId: 'r1', page: 2 }],
    flags: [],
  });
  const [section] = result.sections;
  expect(result.sections).toHaveLength(1);
  expect(section?.blocks[0]?.text?.flags).toEqual(['no_source']);
  expect(section?.blocks[0]?.items.map((item) => [item.lead, item.text, item.flags])).toEqual([
    ['Citations', 'up by 85% overall', ['number_not_in_source']],
    [null, 'Smaller journals too.', []],
  ]);
});
