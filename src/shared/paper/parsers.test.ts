import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseLatex } from './latexParser';
import { parseMarkdown } from './markdownParser';
import { guardPaperSize } from './sizeGuard';
import { itemsToLines, removeRunningHeaders } from './pdfParser';
import { segmentPaper } from '@/core/paper';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
it('parses markdown and latex locally', async () => {
  expect((await parseMarkdown('# Results\n\nFirst.\n\nSecond.')).paragraphs).toHaveLength(2);
  const paper = await parseLatex(
    '\\section{Methods}\nText $x$ here. % comment\n\\begin{figure}\\caption{A result}\\end{figure}\n\\begin{thebibliography}{9}\\bibitem{x} Smith.\\end{thebibliography}',
  );
  expect(paper.sections.map((s) => s.role)).toEqual(['methods', 'references']);
  expect(paper.paragraphs.map((p) => p.kind)).toEqual(['body', 'caption', 'reference']);
  expect(paper.paragraphs[0]?.text).toContain('[math]');
});
it('groups pdf items and removes repeated edge text', () => {
  const lines = itemsToLines(
    [
      { str: 'Hello', transform: [1, 0, 0, 10, 1, 80], height: 10 },
      { str: 'world', transform: [1, 0, 0, 10, 2, 80], height: 10 },
    ],
    100,
  );
  expect(lines[0]?.text).toBe('Hello world');
  const pages = [1, 2].map((page) => ({
    page,
    height: 100,
    lines: [
      { text: 'Header', y: 2, height: 5, x: 0 },
      { text: `Body ${page}`, y: 30, height: 10, x: 0 },
    ],
  }));
  expect(removeRunningHeaders(pages).map((line) => line.text)).toEqual(['Body 1', 'Body 2']);
});
it('rejects files over the size and page limits', () => {
  expect(() => guardPaperSize(25 * 1024 * 1024, 200)).not.toThrow();
  expect(() => guardPaperSize(25 * 1024 * 1024 + 1)).toThrow('25 MB');
  expect(() => guardPaperSize(1, 201)).toThrow('200');
});
it('uses item widths to preserve decimals and insert real word spaces', () => {
  const item = (str: string, x: number, width: number) => ({
    str,
    width,
    height: 10,
    transform: [1, 0, 0, 10, x, 80],
  });
  expect(
    itemsToLines(
      [
        item('p', 0, 4),
        item('<', 7, 4),
        item('0', 14, 4),
        item('.', 18, 1),
        item('0001', 19, 12),
        item('and', 35, 10),
        item('8', 48, 4),
        item('.', 52, 1),
        item('7%', 53, 7),
      ],
      100,
    )[0]?.text,
  ).toBe('p < 0.0001 and 8.7%');
});
it('removes stamps and page numbers while retaining line heights', () => {
  const pages = [
    {
      page: 1,
      height: 100,
      lines: [
        { text: 'arXiv:1234.56789v1', y: 20, height: 6, x: 0 },
        { text: '12', y: 95, height: 8, x: 0 },
        { text: 'Introduction', y: 30, height: 14, x: 0 },
      ],
    },
  ];
  expect(removeRunningHeaders(pages)).toEqual([
    {
      text: 'Introduction',
      pageStart: 1,
      source: 'pdf',
      breakBefore: false,
      height: 14,
      x: 0,
      end: undefined,
      column: undefined,
      columnStart: undefined,
      columnEnd: undefined,
    },
  ]);
});
it('preserves the order and headings of both columns around full-width elements', async () => {
  const item = (str: string, x: number, y: number, width: number, height = 10) => ({
    str,
    width,
    height,
    transform: [1, 0, 0, height, x, 200 - y],
  });
  const items = [
    item('Full page title', 20, 5, 400, 16),
    item('Introduction', 20, 30, 110, 14),
    item('Left text.', 20, 45, 150),
    item('Methods', 20, 60, 100, 14),
    item('Other left text.', 20, 75, 150),
    item('Results: Simulation', 250, 30, 145, 14),
    item('Results text.', 250, 45, 140),
    item('Discussion', 250, 60, 110, 14),
    item('Discussion text.', 250, 75, 140),
    item('Full width figure', 20, 100, 400),
    item('Left lower.', 20, 115, 150),
    item('Left end.', 20, 130, 150),
    item('Conclusions', 250, 115, 100, 14),
    item('Acknowledgements', 250, 130, 145, 14),
  ];
  const lines = itemsToLines(items, 200);
  expect(lines.map((line) => line.text)).toEqual([
    'Full page title',
    'Introduction',
    'Left text.',
    'Methods',
    'Other left text.',
    'Results: Simulation',
    'Results text.',
    'Discussion',
    'Discussion text.',
    'Full width figure',
    'Left lower.',
    'Left end.',
    'Conclusions',
    'Acknowledgements',
  ]);
  const paper = await segmentPaper(removeRunningHeaders([{ page: 1, height: 200, lines }]));
  expect(paper.sections.map((section) => section.heading)).toEqual(
    expect.arrayContaining(['Results: Simulation', 'Discussion', 'Conclusions', 'Acknowledgements']),
  );
  expect(paper.sections.findIndex((section) => section.heading === 'Conclusions')).toBeLessThan(
    paper.sections.findIndex((section) => section.heading === 'Acknowledgements'),
  );
});
it('joins raised adjacent superscripts into their own column line', () => {
  const item = (str: string, x: number, y: number, width: number, height: number) => ({
    str,
    width,
    height,
    transform: [1, 0, 0, height, x, 200 - y],
  });
  const lines = itemsToLines(
    [
      item('43', 20, 30, 12, 10),
      item('rd', 32, 25, 5, 6),
      item(' conference', 37, 30, 50, 10),
      item('Other text', 250, 30, 80, 10),
      item('Left next', 20, 45, 70, 10),
      item('Right next', 250, 45, 70, 10),
    ],
    200,
  );
  expect(lines.map((line) => line.text)).toEqual([
    '43rd conference',
    'Left next',
    'Other text',
    'Right next',
  ]);
});
it('keeps unique edge lines while removing normalized headers appearing on multiple pages', () => {
  const line = (text: string, y: number) => ({ text, y, height: 8, x: 0 });
  const pages = [
    {
      page: 1,
      height: 100,
      lines: [line('Unique title', 5), line('Journal 2024', 7), line('First body', 40)],
    },
    { page: 2, height: 100, lines: [line('Journal 2025', 7), line('Unique footer', 95)] },
  ];
  expect(removeRunningHeaders(pages).map((line) => line.text)).toEqual([
    'Unique title',
    'First body',
    'Unique footer',
  ]);
  expect(
    removeRunningHeaders([{ ...pages[0], page: 1, height: 100, lines: [line('Unique title', 5)] }]).map(
      (item) => item.text,
    ),
  ).toEqual(['Unique title']);
  const many = [
    ...pages,
    { page: 3, height: 100, lines: [line('Third', 40)] },
    { page: 4, height: 100, lines: [line('Fourth', 40)] },
    { page: 5, height: 100, lines: [line('Fifth', 40)] },
  ];
  expect(removeRunningHeaders(many).map((item) => item.text)).toContain('Journal 2024');
});
it('keeps same-baseline columns separate and reads each column from top to bottom', () => {
  const item = (str: string, x: number, y: number, width = 70) => ({
    str,
    width,
    height: 10,
    transform: [1, 0, 0, 10, x, 100 - y],
  });
  const lines = itemsToLines(
    [
      item('Title', 20, 5, 400),
      item('Left first', 20, 30),
      item('Right first', 250, 30),
      item('Left second', 20, 45),
      item('Right second', 250, 45),
    ],
    100,
  );
  expect(lines.map((line) => line.text)).toEqual([
    'Title',
    'Left first',
    'Left second',
    'Right first',
    'Right second',
  ]);
  const narrowGutter = itemsToLines(
    [
      item('Left first', 20, 30, 200),
      item('Right first', 240, 30),
      item('Left second', 20, 45, 200),
      item('Right second', 240, 45),
    ],
    100,
  );
  expect(narrowGutter.map((line) => line.text)).toEqual([
    'Left first',
    'Left second',
    'Right first',
    'Right second',
  ]);
  expect(itemsToLines([item('First', 20, 20), item('Second', 20, 35)], 100).map((line) => line.text)).toEqual(
    ['First', 'Second'],
  );
});
it('does not mistake isolated indents for a column and detects staggered columns', () => {
  const item = (str: string, x: number, y: number) => ({
    str,
    width: 60,
    height: 10,
    transform: [1, 0, 0, 10, x, 200 - y],
  });
  const single = itemsToLines(
    [
      item('One', 20, 20),
      item('Indented', 240, 35),
      item('Two', 20, 50),
      item('Three', 20, 65),
      item('Four', 20, 80),
      item('Five', 20, 95),
    ],
    200,
  );
  expect(single.map((line) => line.text)).toEqual(['One', 'Indented', 'Two', 'Three', 'Four', 'Five']);
  expect(single.every((line) => line.column === undefined)).toBe(true);
  const columns = itemsToLines(
    [
      item('Left one', 20, 20),
      item('Right one', 240, 40),
      item('Left two', 20, 70),
      item('Right two', 240, 90),
      item('Left three', 20, 120),
      item('Right three', 240, 140),
    ],
    200,
  );
  expect(columns.map((line) => line.text)).toEqual([
    'Left one',
    'Left two',
    'Left three',
    'Right one',
    'Right two',
    'Right three',
  ]);
});
it('splits large gaps before page-centre column ordering and joins superscripts with whitespace items', () => {
  const item = (str: string, x: number, y: number, width: number, height = 10) => ({
    str,
    width,
    height,
    transform: [1, 0, 0, height, x, 200 - y],
  });
  const lines = itemsToLines(
    [
      item('Wide title', 20, 10, 360),
      item('Left', 20, 40, 50),
      item('Right', 240, 40, 50),
      item('Left next', 20, 60, 50),
      item('Right next', 240, 60, 50),
      item('43', 20, 80, 12),
      item(' ', 32, 80, 1),
      item('rd', 33, 76, 5, 6),
      item(' ', 38, 76, 3, 6),
      item(' meeting', 41, 80, 50),
      item('Right last', 240, 80, 50),
    ],
    200,
    400,
  );
  expect(lines.map((line) => line.text)).toEqual([
    'Wide title',
    'Left',
    'Left next',
    '43rd meeting',
    'Right',
    'Right next',
    'Right last',
  ]);
  expect(lines.map((line) => line.column)).toEqual([
    'full',
    'left',
    'left',
    'left',
    'right',
    'right',
    'right',
  ]);
});
