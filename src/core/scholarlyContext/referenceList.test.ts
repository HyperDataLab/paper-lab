import { expect, it } from 'vitest';
import type { Paper } from '../schemas';
import { referenceList } from '.';

const at = '2026-01-01T00:00:00.000Z';
const paperWith = (texts: string[]): Paper => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000aa',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 9, sha256: '' },
  sections: [{ id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 9 }],
  paragraphs: texts.map((text, index) => ({
    id: `r${index}`,
    sectionId: 'r',
    order: index,
    kind: 'body' as const,
    text,
    pageStart: 9,
    textHash: '',
  })),
});

it('numbered references joined into one paragraph are listed one by one', () => {
  const items = referenceList(
    paperWith([
      '[1] A. Author, "Federated learning," in Proc. X, 2020. [2] B. Writer, "Edge AI," arXiv preprint arXiv:2101.00001 [3] C. Coder, Green ML, 2021.',
      '[4] D. Dev, CodeCarbon, 2022.',
    ]),
    new Date('2026-06-01'),
  );
  expect(items.map((item) => item.text.slice(0, 3))).toEqual(['[1]', '[2]', '[3]', '[4]']);
  // An arXiv id is not a year; the next entry keeps its own.
  expect(items[1]?.year).toBeNull();
  expect(items[2]?.year).toBe(2021);
  // Each one points to its own words in the paragraph.
  expect(items[1]?.location?.paragraphId).toBe('r0');
  expect((items[1]?.location?.start ?? 0) > 0).toBe(true);
});

it('lists joined dot and parenthesis numbered entries separately', () => {
  const items = referenceList(paperWith(['1. Alpha, A.: First (2020). 2) Beta, B.: Second (2021).']));
  expect(items.map((item) => item.text)).toEqual([
    '1. Alpha, A.: First (2020).',
    '2) Beta, B.: Second (2021).',
  ]);
  expect(items[1]?.location?.start).toBeGreaterThan(0);
});

it('an entry ending with an arXiv id or a year does not swallow the next one', () => {
  const items = referenceList(
    paperWith([
      '[1] A. Author, Title, arXiv:2203.11950',
      '[2] B. Writer, Other title, 2019',
      'continued line.',
    ]),
    new Date('2026-06-01'),
  );
  expect(items).toHaveLength(2);
  expect(items[1]?.text).toBe('[2] B. Writer, Other title, 2019 continued line.');
});

it('a bracketed number quoted inside an entry does not cut it', () => {
  const items = referenceList(
    paperWith(['[1] A. Author, Extending the method of [7], 2020.', '[2] B. Writer, Title, 2021.']),
    new Date('2026-06-01'),
  );
  expect(items).toHaveLength(2);
});
