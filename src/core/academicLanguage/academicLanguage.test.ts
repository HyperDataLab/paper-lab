import { describe, expect, it } from 'vitest';
import type { Paper, PaperParagraph } from '../schemas';
import {
  BASELINE_MIN_PAPERS,
  languageBaseline,
  languageMetrics,
  proseParagraphs,
  repeatedPhrases,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const paragraph = (id: string, text: string, kind: PaperParagraph['kind'] = 'body', sectionId = 'a') => ({
  id,
  sectionId,
  order: 0,
  text,
  kind,
  textHash: id,
  pageStart: 1,
});
const paper = (id: string, paragraphs: PaperParagraph[]): Paper => ({
  schemaVersion: 1,
  id: `00000000-0000-4000-8000-00000000000${id}`,
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [
    { id: 'a', heading: 'Results', role: 'results', level: 1, pageStart: 1 },
    { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 2 },
  ],
  paragraphs,
});

describe('D2 academic language', () => {
  it('reads prose only', () => {
    const value = paper('1', [
      paragraph('p', 'Body text.'),
      paragraph('c', 'Caption.', 'caption'),
      paragraph('r', 'Reference prose.', 'body', 'r'),
    ]);
    expect(proseParagraphs(value).map((item) => item.id)).toEqual(['p']);
    expect(proseParagraphs(value, 'r')).toEqual([]);
  });
  it('computes density, long words and sentence length', () => {
    const metrics = languageMetrics([paragraph('p', 'The method improves measurement. It works.')]);
    expect(metrics.words).toBe(6);
    expect(metrics.lexicalDensity).toBeCloseTo(4 / 6);
    expect(metrics.longWordShare).toBeCloseTo(2 / 6);
    expect(metrics.sentenceWords).toBe(3);
  });
  it('reports no diversity under one full run, and is not inflated by length', () => {
    expect(languageMetrics([paragraph('p', 'one two three')]).diversity).toBeNull();
    const distinct = Array.from(
      { length: 1000 },
      (_, index) => `w${String.fromCharCode(97 + (index % 10))}`,
    ).join(' ');
    const once = languageMetrics([paragraph('p', distinct)]).diversity;
    const twice = languageMetrics([paragraph('p', `${distinct} ${distinct}`)]).diversity;
    expect(once).toBe(10);
    expect(twice).toBe(10);
  });
  it('gives no metrics for no text', () => {
    expect(languageMetrics([])).toEqual({
      words: 0,
      lexicalDensity: null,
      diversity: null,
      longWordShare: null,
      sentenceWords: null,
    });
  });
  it('finds phrases repeated across paragraphs, broken by punctuation', () => {
    const phrases = repeatedPhrases([
      paragraph('a', 'the results of this study were clear and the results of this study held'),
      paragraph('b', 'we saw the results of this study again'),
      paragraph('c', 'the results, of this study'),
      paragraph('d', 'and so it is and so it is and so it is'),
    ]);
    const found = phrases.find((item) => item.phrase === 'the results of this');
    expect(found).toMatchObject({ count: 3, paragraphs: 2 });
    expect(found?.location).toEqual({ paragraphId: 'a', start: 0, end: 19 });
    expect(phrases.some((item) => item.phrase === 'and so it is')).toBe(false);
  });
  it('ignores a phrase repeated inside one paragraph only', () => {
    expect(
      repeatedPhrases([paragraph('a', 'big data model works big data model works big data model works')]),
    ).toEqual([]);
  });
  it('builds a baseline only from enough papers', () => {
    const papers = ['1', '2', '3', '4'].map((id) =>
      paper(id, [paragraph('p', 'The method improves measurement.')]),
    );
    expect(languageBaseline(papers.slice(0, BASELINE_MIN_PAPERS - 1))).toBeNull();
    expect(languageBaseline([...papers.slice(0, 2), paper('5', [])])).toBeNull();
    const baseline = languageBaseline(papers);
    expect(baseline?.papers).toBe(4);
    expect(baseline?.lexicalDensity).toBeCloseTo(3 / 4);
    expect(baseline?.diversity).toBeNull();
  });
});
