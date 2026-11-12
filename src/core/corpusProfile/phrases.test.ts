import { describe, expect, it } from 'vitest';
import { PHRASE_RULES, phraseSignals, phraseTokens, type PhrasePaper } from './phrases';

const paper = (id: string, ...texts: string[]): PhrasePaper => ({
  memberExportId: id,
  sentences: texts.map((text, i) => ({ key: `${id}-${i}`, text })),
});
const ids = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);

describe('C5a phrase keyness', () => {
  it('C5a normalises tokens: lower case, words only, curly apostrophes straight', () => {
    expect(phraseTokens('The Model’s F1 rose by 3.5% [12], (Smith, 2020).')).toEqual([
      'the',
      "model's",
      'f1',
      'rose',
      'by',
    ]);
  });
  it('C5a finds target phrases by paper-level G² and keeps decision 5', () => {
    const target = [
      ...ids('t', 10).map((id) =>
        paper(id, 'Hence the proposed hybrid scheme wins.', `Unique filler ${id} sentence.`),
      ),
    ];
    // "rare marker" is in four target papers only: below the five-paper floor.
    for (const item of target.slice(0, 4))
      item.sentences = [...item.sentences, { key: 'r', text: 'Rare marker.' }];
    const control = ids('c', 10).map((id) => paper(id, 'Hence we study something else.', 'Other text here.'));
    const result = phraseSignals(target, control);
    const texts = result.items.map((item) => item.text);
    expect(texts).toContain('proposed hybrid scheme');
    expect(texts).toContain('the proposed hybrid scheme wins');
    expect(texts).not.toContain('rare marker');
    // "hence" is in every paper on both sides, so it is tested but has G² = 0.
    expect(texts).not.toContain('hence');
    expect(texts.every((text) => text.split(' ').length <= PHRASE_RULES.maxWords)).toBe(true);
    const top = result.items.find((item) => item.text === 'proposed hybrid scheme');
    // 10 of 10 papers against 0 of 10: cells [10, 0, 0, 10], every expected cell 5, G² = 40 ln 2.
    expect(top?.g2).toBeCloseTo(40 * Math.log(2));
    expect(top).toMatchObject({
      targetPapers: 10,
      controlPapers: 0,
      targetPrevalence: 1,
      controlPrevalence: 0,
    });
    expect(top?.qValue).toBeLessThan(0.05);
    expect(top?.evidence).toEqual([
      { memberExportId: 't00', sentenceKey: 't00-0', excerpt: 'Hence the proposed hybrid scheme wins.' },
      { memberExportId: 't01', sentenceKey: 't01-0', excerpt: 'Hence the proposed hybrid scheme wins.' },
      { memberExportId: 't02', sentenceKey: 't02-0', excerpt: 'Hence the proposed hybrid scheme wins.' },
    ]);
    expect(top?.phraseId).toMatch(/^phrase\.3\.[0-9a-f]{8}$/u);
    // Ties in G² are broken by text, and the result is the same on a second run.
    expect(phraseSignals(target, control)).toEqual(result);
    expect(result.tested).toBeGreaterThan(result.items.length);
  });
  it('C5a never crosses a sentence boundary and caps excerpts at 300 characters', () => {
    const long = `${'Lorem ipsum dolor sit amet '.repeat(20)}key phrase here ${'consectetur adipiscing elit '.repeat(20)}`;
    const target = ids('t', 6).map((id) => paper(id, 'Alpha beta.', 'Gamma delta.', long));
    const control = ids('c', 6).map((id) => paper(id, 'Other words only.'));
    const result = phraseSignals(target, control, { ...PHRASE_RULES, top: 1000 });
    expect(result.items.map((item) => item.text)).not.toContain('beta gamma');
    const key = result.items.find((item) => item.text === 'key phrase here');
    const excerpt = key?.evidence[0]?.excerpt ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(300);
    expect(excerpt).toContain('key phrase here');
    expect(excerpt.startsWith('…')).toBe(true);
  });
  it('C5a returns no phrases without both corpora', () => {
    expect(phraseSignals([], [paper('c1', 'x y z')])).toEqual({ tested: 0, items: [] });
  });
});
