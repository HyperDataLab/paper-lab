import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { PaperSchema } from '@/core/schemas';
import { segmentPaper } from '@/core/paper';
import { itemsToLines, removeRunningHeaders, type TextItemLike } from './pdfParser';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));

const PAGE = { width: 612, height: 792 };
const item = (str: string, x: number, y: number, width = str.length * 5): TextItemLike => ({
  str,
  transform: [1, 0, 0, 10, x, PAGE.height - y],
  height: 10,
  width,
});
const row = (y: number, cells: [string, number][]) => cells.map(([text, x]) => item(text, x, y));
const pages = (items: TextItemLike[]) => [
  { page: 1, height: PAGE.height, width: PAGE.width, lines: itemsToLines(items, PAGE.height, PAGE.width) },
];
const parse = (items: TextItemLike[]) => segmentPaper(removeRunningHeaders(pages(items)));
const heading = item('Results', 72, 80);

const regular = (top: number, x = [72, 220, 360]) => [
  ...row(top, [
    ['Model', x[0] ?? 0],
    ['Accuracy', x[1] ?? 0],
    ['Loss', x[2] ?? 0],
  ]),
  ...row(top + 14, [
    ['Baseline', x[0] ?? 0],
    ['0.123 ± 0.004', x[1] ?? 0],
    ['-1.5 %', x[2] ?? 0],
  ]),
  ...row(top + 28, [
    ['Proposed', x[0] ?? 0],
    ['0.456 ± 0.010', x[1] ?? 0],
    ['-0.7 %', x[2] ?? 0],
  ]),
  ...row(top + 42, [
    ['Oracle', x[0] ?? 0],
    ['0.789 ± 0.002', x[1] ?? 0],
    ['-0.2 %', x[2] ?? 0],
  ]),
];
const caption = item('Table 1: Synthetic comparison of three models.', 72, 100, 300);
const tableOf = async (items: TextItemLike[]) => {
  const paper = await parse(items);
  return { paper, table: paper.paragraphs.find((p) => p.kind === 'table') };
};

it('M1 keeps exact cell text with its row and column', async () => {
  const { table } = await tableOf([heading, caption, ...regular(120)]);
  expect(table?.table?.columns).toBe(3);
  expect(table?.table?.confidence).toBe('high');
  expect(table?.table?.rows[1]?.cells).toEqual([
    { text: 'Baseline', column: 0 },
    { text: '0.123 ± 0.004', column: 1 },
    { text: '-1.5 %', column: 2 },
  ]);
  expect(table?.text.split('\n')[2]).toBe('Proposed 0.456 ± 0.010 -0.7 %');
});

it('M1 links a caption above and below the table', async () => {
  const above = await tableOf([heading, caption, ...regular(120)]);
  const captionAbove = above.paper.paragraphs.find((p) => p.kind === 'caption');
  expect(above.table?.table?.captionId).toBe(captionAbove?.id);
  const below = await tableOf([heading, ...regular(100), item('Table 2. Results below.', 72, 160, 200)]);
  const captionBelow = below.paper.paragraphs.find((p) => p.kind === 'caption');
  expect(captionBelow).toBeDefined();
  expect(below.table?.table?.captionId).toBe(captionBelow?.id);
});

it('M1 reads a table inside one column of a two-column page', async () => {
  const body = Array.from({ length: 12 }, (_, index) =>
    item('A long right column sentence that fills the column.', 330, 100 + index * 14, 240),
  );
  const leftText = Array.from({ length: 4 }, (_, index) =>
    item('A long left column sentence that fills the column.', 72, 200 + index * 14, 240),
  );
  const { table, paper } = await tableOf([
    heading,
    item('Table 1: Narrow table.', 72, 100, 120),
    ...regular(120, [72, 140, 230]),
    ...body,
    ...leftText,
  ]);
  expect(table?.table?.columns).toBe(3);
  expect(table?.text).not.toContain('right column');
  expect(paper.paragraphs.some((p) => p.kind === 'body' && p.text.includes('right column'))).toBe(true);
});

it('M1 reads a full-width table on a two-column page', async () => {
  const left = Array.from({ length: 5 }, (_, index) =>
    item('A long left column sentence that fills the column.', 72, 100 + index * 14, 240),
  );
  const right = Array.from({ length: 5 }, (_, index) =>
    item('A long right column sentence that fills the column.', 330, 100 + index * 14, 240),
  );
  const { table } = await tableOf([
    heading,
    ...left,
    ...right,
    item('Table 3: Wide table.', 72, 190, 150),
    ...regular(210, [72, 300, 500]),
  ]);
  expect(table?.table?.columns).toBe(3);
  expect(table?.table?.rows).toHaveLength(4);
});

it('M1 marks a misaligned row low confidence and never guesses its column', async () => {
  const { table } = await tableOf([
    heading,
    caption,
    ...regular(120),
    ...row(176, [
      ['Shifted', 72],
      ['0.111', 170],
      ['-0.1 %', 360],
    ]),
  ]);
  expect(table?.table?.confidence).toBe('low');
  expect(table?.table?.rows[4]?.cells[1]).toEqual({ text: '0.111', column: null });
});

it('M1 marks a merged header cell low confidence', async () => {
  const { table } = await tableOf([
    heading,
    caption,
    item('Accuracy and loss together', 215, 120, 160),
    ...row(120, [['Group', 72]]),
    ...regular(134),
  ]);
  expect(table?.table?.confidence).toBe('low');
});

it('M1 leaves an aligned list and aligned prose as ordinary text', async () => {
  const list = Array.from({ length: 4 }, (_, index) => [
    item(`${index + 1}.`, 72, 100 + index * 14),
    item(`Item number ${index + 1} of the list`, 120, 100 + index * 14),
  ]).flat();
  expect((await tableOf([heading, ...list])).table).toBeUndefined();
  const prose = Array.from({ length: 4 }, (_, index) => [
    item('Left words only', 72, 100 + index * 14),
    item('Right words only', 300, 100 + index * 14),
  ]).flat();
  expect((await tableOf([heading, ...prose])).table).toBeUndefined();
});

it('M1 does not treat numbers beside a figure as a table', async () => {
  const axis = Array.from({ length: 4 }, (_, index) => [
    item(`0.${index + 1}`, 72, 100 + index * 14),
    item(`0.${index + 5}`, 200, 100 + index * 14),
  ]).flat();
  expect((await tableOf([heading, ...axis, item('Figure 1: A chart.', 72, 170, 100)])).table).toBeUndefined();
});

it('M1 flags an uncaptioned numeric table for review', async () => {
  const { table } = await tableOf([heading, ...regular(120)]);
  expect(table?.table?.confidence).toBe('low');
  expect(table?.table?.captionId).toBeNull();
});

it('M1 labels numbered equations and keeps their text', async () => {
  const joined = await parse([heading, item('E = m c squared (12)', 72, 100, 200)]);
  expect(joined.paragraphs[0]).toMatchObject({ kind: 'equation', equationLabel: '12' });
  expect(joined.paragraphs[0]?.text).toBe('E = m c squared (12)');
  const split = await parse([heading, item('a = b + c', 72, 100, 60), item('(3)', 500, 100, 15)]);
  expect(split.paragraphs).toHaveLength(1);
  expect(split.paragraphs[0]).toMatchObject({ kind: 'equation', equationLabel: '3', text: 'a = b + c (3)' });
  const plain = await parse([heading, item('x = y', 72, 100, 30)]);
  expect(plain.paragraphs[0]?.equationLabel).toBeNull();
});

it('M1 produces deterministic paragraph ids', async () => {
  const items = [heading, caption, ...regular(120), item('Closing sentence of the section.', 72, 200, 200)];
  const first = await parse(items);
  const second = await parse(items);
  expect(second.paragraphs.map((p) => [p.id, p.textHash])).toEqual(
    first.paragraphs.map((p) => [p.id, p.textHash]),
  );
});

it('M1 still parses papers saved before tables existed', () => {
  const parsed = PaperSchema.parse({
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Old',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: { kind: 'pdf', fileName: 'old.pdf', pageCount: 1, sha256: 'sha256:x' },
    sections: [],
    paragraphs: [
      { id: 'p', sectionId: 's', order: 0, text: 'Old.', pageStart: 1, kind: 'body', textHash: 'h' },
    ],
  });
  expect(parsed.paragraphs[0]?.table).toBeUndefined();
  expect(parsed.source.parserVersion).toBeUndefined();
});

it('M1 keeps single-column prose unchanged', async () => {
  const items = Array.from({ length: 5 }, (_, index) =>
    item('An ordinary single column line of prose in a paper', 72, 100 + index * 14, 468),
  );
  const paper = await parse([heading, ...items]);
  expect(paper.paragraphs.map((p) => p.kind)).toEqual(['body']);
});
