import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { segmentPaper } from './segmentPaper';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
it('segments headings, roles, captions, references and stable ids while preserving text', async () => {
  const input =
    '# Abstract\n\nA  😀 experi-\nment.\n\n1. Introduction\n\nText.\n\n## Materials and Methods\n\nFigure 3. Caption\n\nx = 2\n\nRelated Work\n\nPrior work.\n\nReferences\n\nSmith 2020.';
  const result = await segmentPaper(input);
  expect(await segmentPaper(input)).toEqual(result);
  expect(result.sections.map((s) => s.role)).toEqual([
    'abstract',
    'introduction',
    'methods',
    'related_work',
    'references',
  ]);
  expect(result.paragraphs.map((p) => p.kind)).toEqual([
    'body',
    'body',
    'caption',
    'equation',
    'body',
    'reference',
  ]);
  expect(result.paragraphs[0]).toMatchObject({ id: 'sec1_p01', text: 'A  😀 experiment.' });
});
it('filters list items, fragments and numeric noise and inherits subsection roles', async () => {
  const result = await segmentPaper([
    { text: '1 Introduction', height: 14 },
    { text: 'Regular text.', height: 10 },
    { text: '1. We describe a result', height: 10 },
    { text: '2. Another ordinary item', height: 10 },
    { text: '0.2 0.4 0.6 0.8 1.0', height: 10 },
    { text: '20 40 60 80 100', height: 10 },
    { text: 'X', height: 10 },
    { text: '≤ i<j ≤ m p', height: 10 },
    { text: 'Beyond the incom-', height: 10 },
    { text: '. A sentence fragment.', height: 10 },
    { text: 'and some remaining text,', height: 10 },
    { text: '2 Methods', height: 14 },
    { text: '2.1 Metrics', height: 12 },
    { text: 'A measurement.', height: 10 },
    { text: '2.2 Sampling', height: 12 },
    { text: '3 Results', height: 14 },
  ]);
  expect(result.sections.map((section) => [section.heading, section.role])).toEqual([
    ['Introduction', 'introduction'],
    ['Methods', 'methods'],
    ['Metrics', 'methods'],
    ['Sampling', 'methods'],
    ['Results', 'results'],
  ]);
});
it('drops stamps and page numbers and separates venue and correspondence footnotes', async () => {
  const result = await segmentPaper(
    'Introduction\n\nA body sentence.\n42\narXiv:9999.12345v1 [cs.AI]\nProceedings of the Example Conference\nCopyright 2025 by the author\nCorrespondence to: author@example.org',
  );
  expect(result.paragraphs.map((p) => p.kind)).toEqual(['body', 'footnote', 'footnote', 'footnote']);
  expect(result.paragraphs.map((p) => p.text).join(' ')).not.toContain('arXiv');
});
it('joins a wrapped heading without absorbing the following paragraph', async () => {
  const result = await segmentPaper([
    { text: '1 Methods for examining', height: 14 },
    { text: 'complex patterns', height: 14 },
    { text: 'This is ordinary text.', height: 10 },
    { text: '2 Results', height: 14 },
    { text: 'A new paragraph begins.', height: 10 },
  ]);
  expect(result.sections.map((s) => s.heading)).toEqual([
    'Methods for examining complex patterns',
    'Results',
  ]);
  expect(result.paragraphs.map((p) => p.text)).toEqual(['This is ordinary text.', 'A new paragraph begins.']);
});
it('joins small consecutive footnote lines without absorbing body text', async () => {
  const result = await segmentPaper([
    { text: 'Introduction', height: 14, pageStart: 1 },
    { text: 'Body text.', height: 10, pageStart: 1 },
    { text: 'Proceedings of the Example Conference', height: 7, pageStart: 1 },
    { text: 'Held in a fictional city.', height: 7, pageStart: 1 },
    { text: 'Normal text resumes.', height: 10, pageStart: 1 },
  ]);
  expect(result.paragraphs.map((p) => [p.kind, p.text])).toEqual([
    ['body', 'Body text.'],
    ['footnote', 'Proceedings of the Example Conference Held in a fictional city.'],
    ['body', 'Normal text resumes.'],
  ]);
});
it('keeps continuation candidates in the same column and rejects prose and citations', async () => {
  const left = {
    pageStart: 1,
    height: 14,
    x: 20,
    end: 160,
    column: 'left' as const,
    columnStart: 20,
    columnEnd: 200,
  };
  const right = { ...left, x: 240, end: 370, column: 'right' as const, columnStart: 200, columnEnd: 450 };
  const paper = await segmentPaper([
    { ...left, text: '1 Methods and design' },
    { ...left, text: 'for paired studies' },
    { ...right, text: 'Results' },
    { ...left, text: '2 Discussion of patterns' },
    { ...right, text: 'those of other authors across' },
    { ...right, text: 'Conclusion', breakBefore: true },
    { ...right, text: 'A result (Jones et al., 2023) suggests' },
    { ...right, text: 'Acknowledgements', breakBefore: true },
    { ...right, text: 'the unfinished exam-' },
    { ...right, text: 'A body sentence is complete' },
  ]);
  expect(paper.sections.map((s) => s.heading)).toEqual([
    'Methods and design for paired studies',
    'Results',
    'Discussion of patterns',
    'Conclusion',
    'Acknowledgements',
  ]);
  expect(paper.paragraphs.map((p) => p.text).join(' ')).toContain('(Jones et al., 2023)');
});
it('joins wrapped headings in either column and continues body across column and page breaks', async () => {
  const left = { x: 20, end: 160, height: 14, pageStart: 1, column: 'left' as const };
  const right = { ...left, x: 240, end: 380, column: 'right' as const };
  const input = [
    { ...left, text: '1 Methods for synthetic' },
    { ...left, text: 'paired examples' },
    { ...left, height: 10, text: 'A synthetic para-' },
    { ...right, height: 10, text: 'graph continues', breakBefore: true },
    { ...right, height: 10, pageStart: 2, text: 'across pages.' },
    { ...right, pageStart: 2, text: '2 Results: Paired patterns', breakBefore: true },
    { ...right, pageStart: 2, text: 'in synthetic samples' },
    { ...right, height: 10, pageStart: 2, text: 'A complete sentence.' },
  ];
  const paper = await segmentPaper(input);
  expect(paper.sections.map((s) => s.heading)).toEqual([
    'Methods for synthetic paired examples',
    'Results: Paired patterns in synthetic samples',
  ]);
  expect(paper.paragraphs.map((p) => p.text)).toEqual([
    'A synthetic paragraph continues across pages.',
    'A complete sentence.',
  ]);
  expect(await segmentPaper(input)).toEqual(paper);
});
it('groups hanging and numbered references and assigns appendix roles while rejecting prompt blocks', async () => {
  const paper = await segmentPaper([
    { text: 'References', height: 14 },
    { text: 'Stone, A. A fictional entry.', x: 20 },
    { text: 'More fictional details.', x: 35 },
    { text: 'Vale, B. Another entry.', x: 20 },
    { text: 'Continued details.', x: 35 },
    { text: '[3] A numbered entry.', x: 20 },
    { text: 'Its continuation.', x: 35 },
    { text: 'A Limitations', height: 14 },
    { text: 'A synthetic limitation.', height: 10 },
    { text: 'B.1 Additional analysis', height: 14 },
    { text: 'PAPER TITLE: {title}', height: 14 },
    { text: 'OUTPUT FORMAT:', height: 14 },
    { text: 'Results', height: 14, monospace: true },
    { text: 'Methods', height: 14, boxed: true },
  ]);
  expect(paper.sections.map((s) => [s.heading, s.role])).toEqual([
    ['References', 'references'],
    ['Limitations', 'appendix'],
    ['Additional analysis', 'appendix'],
  ]);
  expect(paper.paragraphs.filter((p) => p.kind === 'reference').map((p) => p.text)).toEqual([
    'Stone, A. A fictional entry. More fictional details.',
    'Vale, B. Another entry. Continued details.',
    '[3] A numbered entry. Its continuation.',
  ]);
});
it('treats PDF prompt text and reference continuations as text while joining indented heading wraps', async () => {
  const base = { source: 'pdf' as const, height: 10, pageStart: 1, column: 'right' as const };
  const paper = await segmentPaper([
    { ...base, x: 200, text: '1 Introduction' },
    { ...base, x: 200, text: '# SAMPLE PROMPT:' },
    { ...base, x: 200, text: 'SYNTHETIC INSTRUCTION' },
    { ...base, x: 200, text: '2 Results: Synthetic analysis is' },
    { ...base, x: 220, text: 'useful' },
    { ...base, x: 200, text: 'References' },
    { ...base, x: 200, text: 'Stone, A. Synthetic title.' },
    { ...base, x: 210, text: 'A. Fictional continuation. In Proceedings' },
    { ...base, x: 210, text: 'of an invented event.' },
    { ...base, x: 200, text: 'Vale, B. Another synthetic entry.' },
    { ...base, x: 200, text: 'A Limitations', height: 14 },
    { ...base, x: 200, text: 'B.1 Further analysis', height: 14 },
  ]);
  expect(paper.sections.map((s) => s.heading)).toEqual([
    'Introduction',
    'Results: Synthetic analysis is useful',
    'References',
    'Limitations',
    'Further analysis',
  ]);
  expect(paper.paragraphs.filter((p) => p.kind === 'reference').map((p) => p.text)).toEqual([
    'Stone, A. Synthetic title. A. Fictional continuation. In Proceedings of an invented event.',
    'Vale, B. Another synthetic entry.',
  ]);
});
it('recognizes numbered uppercase PDF section names while rejecting numbered prompts', async () => {
  const pdf = { source: 'pdf' as const, height: 12, pageStart: 1 };
  const result = await segmentPaper([
    { ...pdf, text: '1 INTRODUCTION' },
    { ...pdf, text: 'A synthetic sentence.' },
    { ...pdf, text: '2 METHODS' },
    { ...pdf, text: 'A method description.' },
    { ...pdf, text: '3 OUTPUT FORMAT' },
  ]);
  expect(result.sections.map((section) => [section.heading, section.role])).toEqual([
    ['INTRODUCTION', 'introduction'],
    ['METHODS', 'methods'],
  ]);
});
it('starts a named reference at a different x from the hanging-indent minimum', async () => {
  const result = await segmentPaper([
    { text: 'References', x: 20, pageStart: 1 },
    { text: 'Oak, A. First fictional entry.', x: 20, pageStart: 1 },
    { text: 'continued details.', x: 30, pageStart: 1 },
    { text: 'Vale, B. Second fictional entry.', x: 35, pageStart: 1 },
    { text: 'more details.', x: 45, pageStart: 1 },
  ]);
  expect(result.paragraphs.map((paragraph) => paragraph.text)).toEqual([
    'Oak, A. First fictional entry. continued details.',
    'Vale, B. Second fictional entry. more details.',
  ]);
});
it('continues across page or column changes but respects an ordinary vertical gap', async () => {
  const left = { pageStart: 1, column: 'left' as const };
  const right = { pageStart: 1, column: 'right' as const };
  const result = await segmentPaper([
    { ...left, text: 'Introduction' },
    { ...left, text: 'An unfinished passage' },
    { ...left, text: 'separate paragraph.', breakBefore: true },
    { ...left, text: 'An intercolumn para-', breakBefore: true },
    { ...right, text: 'graph continues', breakBefore: true },
    { ...right, pageStart: 2, text: 'across pages.' },
  ]);
  expect(result.paragraphs.map((paragraph) => paragraph.text)).toEqual([
    'An unfinished passage',
    'separate paragraph.',
    'An intercolumn paragraph continues across pages.',
  ]);
});
