import { describe, expect, it } from 'vitest';
import { mapSpan, parseBrat, scoreSpans, toPaper } from './drInventor';

describe('BENCH Dr. Inventor adapter', () => {
  it('BENCH parses labels and ignores relations and unsupported spans', () => {
    expect(
      parseBrat('T1\town_claim 1 4\tone\nR1\tsupport Arg1:T1 Arg2:T2\nT2\tdata 7 9\ttwo\nT3\tother 1 2\tx'),
    ).toEqual([
      { label: 'own_claim', start: 1, end: 4 },
      { label: 'data', start: 7, end: 9 },
    ]);
  });

  it('BENCH maps Unicode, entities and embedded tags to raw code-point offsets', () => {
    const raw = '<Title>Example</Title><H1>Results</H1><Sentence>🐈 &amp; <b>mice</b> win.</Sentence>';
    const { paper, mapping } = toPaper(raw, 'A01');
    expect(paper.title).toBe('Example');
    expect(paper.sections[0]?.heading).toBe('Results');
    expect(paper.paragraphs[0]?.text).toBe('🐈 & mice win.');
    const span = mapSpan(mapping, 'p1', 4, 8);
    expect(Array.from(raw).slice(span?.rawStart, span?.rawEnd).join('')).toBe('mice');
    const entity = mapSpan(mapping, 'p1', 2, 3);
    expect(Array.from(raw).slice(entity?.rawStart, entity?.rawEnd).join('')).toBe('&amp;');
  });

  it('BENCH splits plain text on blank lines without headings', () => {
    const { paper } = toPaper('First sentence.\n\nSecond sentence.', 'A02');
    expect(paper.sections).toHaveLength(1);
    expect(paper.paragraphs.map((p) => p.text)).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('BENCH scores the largest overlap, source boundary, recall and majority baseline', () => {
    const gold = [
      { label: 'own_claim' as const, start: 0, end: 5 },
      { label: 'background_claim' as const, start: 5, end: 12 },
      { label: 'data' as const, start: 20, end: 25 },
      { label: 'data' as const, start: 30, end: 35 },
    ];
    const score = scoreSpans(
      [
        { kind: 'claim', rawStart: 3, rawEnd: 11 },
        { kind: 'claim', rawStart: 0, rawEnd: 2 },
        { kind: 'data', rawStart: 20, rawEnd: 22 },
        { kind: 'data', rawStart: 40, rawEnd: 42 },
      ],
      gold,
    );
    expect(score.confusion.claim.background_claim).toBe(1);
    expect(score.precision).toEqual({ claim: 0.5, data: 0.5 });
    expect(score.recall).toEqual({ own_claim: 1, data: 0.5 });
    expect(score.majorityLabel).toBe('data');
    expect(score.majorityBaseline).toBe(0.25);
    expect(scoreSpans([], []).precision.claim).toBeNull();
  });
});
