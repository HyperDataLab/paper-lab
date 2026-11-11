/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ABBREVIATIONS,
  analyzeText,
  codePointLength,
  cpToUtf16,
  createOffsetIndex,
  isPunctuation,
  OffsetError,
  segmentSentences,
  sliceCp,
  sourceHash,
  tokenize,
  toUtf16Span,
  utf16ToCp,
} from './index';

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});
const fixtures: [string, number][] = [
  ['👩‍🔬 works 🇻🇳. Next study.', 2],
  ['cafe\u0301 and naïve 中文研究. Next sentence.', 2],
  ['Tiếng Việt  \tworks.\u00a0Next\nline.', 2],
  ['Evidence [12] and [3–5, 8] (Smith et al., 2010). Next.', 2],
  ['Evidence (Smith and Lee 2019; Wu 2020a). Next.', 2],
  ['A (nested (detail.) Further detail) remains. Next.', 2],
  ['Values 3.14 and p<0.05. Next 95%.', 2],
  ['Wait... and continue. “Done!” [Next?] Last', 4],
  ['No final punctuation', 1],
  ['', 0],
  [' \t\n\u00a0', 0],
];
describe('AC-11 exact source alignment', () => {
  it.each(fixtures)('preserves tokens and sentence boundaries for %s', (text, count) => {
    const tokens = tokenize(text);
    expect(segmentSentences(text)).toHaveLength(count);
    for (const token of tokens) expect(sliceCp(text, token.start, token.end)).toBe(token.text);
    expect(tokens.map((token) => token.text.replace(/\s/gu, '')).join('')).toBe(text.replace(/\s/gu, ''));
  });
  it.each(ABBREVIATIONS)('keeps abbreviation %s within a sentence', (abbr) => {
    const text = `See ${abbr} ${abbr === 'etc.' ? 'more' : 'Results'} here. Next sentence.`;
    expect(segmentSentences(text)).toHaveLength(2);
    for (const token of tokenize(text)) expect(sliceCp(text, token.start, token.end)).toBe(token.text);
  });
  it('handles initials, parentheses and number forms', () => {
    const text = 'J. Schimel (see Fig. 2. for detail) reports −3.2, ±0.4, 1,000, 10^-3 and 2×10³. Next.';
    expect(segmentSentences(text)).toHaveLength(2);
    expect(
      tokenize(text)
        .filter((t) => t.kind === 'number')
        .map((t) => t.text),
    ).toEqual(['2', '−3.2', '±0.4', '1,000', '10^-3', '2', '10³']);
  });
  it('classifies citations, graphemes, words, punctuation and symbols', () => {
    const tokens = tokenize("👩‍🔬 🇻🇳 state-of-the-art don't Schimel’s 95% [12] (Smith et al., 2010) p<0.05!");
    expect(tokens.map((t) => t.text)).toEqual([
      '👩‍🔬',
      '🇻🇳',
      'state-of-the-art',
      "don't",
      'Schimel’s',
      '95%',
      '[12]',
      '(Smith et al., 2010)',
      'p',
      '<',
      '0.05',
      '!',
    ]);
    expect(tokens.filter((t) => t.kind === 'citation')).toHaveLength(2);
    expect(isPunctuation(tokens[11] as (typeof tokens)[number])).toBe(true);
    expect(isPunctuation(tokens[9] as (typeof tokens)[number])).toBe(false);
    expect(isPunctuation(tokens[0] as (typeof tokens)[number])).toBe(true);
    expect(tokenize('1️⃣')[0]).toMatchObject({ text: '1️⃣', kind: 'symbol' });
  });
  it('converts code point offsets and rejects invalid offsets', () => {
    for (const text of ['', 'abc', 'a👩‍🔬🇻🇳 cafe\u0301 中文']) {
      const index = createOffsetIndex(text);
      for (let cp = 0; cp <= codePointLength(text); cp++) {
        expect(utf16ToCp(text, cpToUtf16(text, cp))).toBe(cp);
        expect(index.utf16ToCp(index.cpToUtf16(cp))).toBe(cp);
      }
    }
    expect(() => utf16ToCp('😀', 1)).toThrow(OffsetError);
    expect(() => cpToUtf16('a', -1)).toThrow(OffsetError);
    expect(() => cpToUtf16('a', 1.5)).toThrow(OffsetError);
    expect(() => utf16ToCp('a', 2)).toThrow(OffsetError);
    expect(() => toUtf16Span('a', { start: 1, end: 0 })).toThrow(OffsetError);
    expect(toUtf16Span('😀a', { start: 0, end: 1 })).toEqual({ start: 0, end: 2 });
    expect(tokenize('a 😀 b', { start: 2, end: 3 })[0]?.text).toBe('😀');
  });
});
it('EV-01 AC-01 segments the PRD paragraph at exact offsets', async () => {
  const text =
    'The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system.';
  const analysis = await analyzeText(text);
  expect(analysis.sourceText).toBe(text);
  expect(analysis.sentences.map(({ start, end }) => [start, end])).toEqual([
    [0, 115],
    [116, 156],
    [157, 215],
  ]);
  expect(
    analysis.tokens.slice(analysis.sentences[0]?.tokenStart, analysis.sentences[0]?.tokenEnd).at(-1)?.text,
  ).toBe('.');
});
it('AC-11 hashes exact UTF-8 bytes', async () => {
  expect(await sourceHash('abc')).toBe(
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  expect(await sourceHash('abc')).toBe(await sourceHash('abc'));
  expect(await sourceHash('abc ')).not.toBe(await sourceHash('abc'));
});
describe('R17a unmatched brackets from PDF text', () => {
  const texts = (text: string) => segmentSentences(text).map((s) => sliceCp(text, s.start, s.end));
  it('an unmatched opener no longer blocks later splits', () => {
    expect(texts('Results (see Table 2. Values rose. Rates fell. Done.')).toEqual([
      'Results (see Table 2.',
      'Values rose.',
      'Rates fell.',
      'Done.',
    ]);
    expect(texts('Data [12 were used. We then fit a model. It converged.')).toHaveLength(3);
    expect(texts('A mismatched (pair] stays. Next one. Last.')).toHaveLength(3);
  });
  it('a matched parenthetical with a full stop still does not split inside it', () => {
    expect(texts('We used one method (It failed. We stopped) and then another. Next.')).toEqual([
      'We used one method (It failed. We stopped) and then another.',
      'Next.',
    ]);
    expect(texts('Open (one. Two) then (three. Four) here. Next.')).toHaveLength(2);
  });
  it('a stray closer does not count as closing a sentence-final bracket', () => {
    expect(texts('First point.) Second point. Third.')).toHaveLength(3);
  });
});
