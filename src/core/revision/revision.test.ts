import { describe, expect, it } from 'vitest';
import { alignRevision, attachChanges } from './align';
import { meaningChecks } from './meaningChecks';
import { sliceCp } from '../text/offsets';

describe('revision', () => {
  it('R2 compares generic adjacent units, including compound units', () => {
    for (const [before, after] of [
      ['5 days', '5 weeks'],
      ['10 mg/L', '10 g/L'],
      ['3 h', '3 min'],
      ['2 m', '2 M'],
    ] as const) {
      expect(meaningChecks(before, after, []).find((check) => check.id === 'numbers_preserved')?.status).toBe(
        'fail',
      );
      expect(
        meaningChecks(before, before, []).find((check) => check.id === 'numbers_preserved')?.status,
      ).toBe('pass');
    }
  });
  it('R4 anchors full model quotations and attaches internal hunks', () => {
    const source = 'The result is very large';
    const revised = 'The result is large';
    const hunks = alignRevision(source, revised);
    const result = attachChanges(source, revised, hunks, [
      { issueIds: ['i'], before: source, after: revised, rationale: 'Rõ hơn' },
    ]);
    expect(result.unmatchedChanges).toEqual([]);
    expect(result.hunks.filter((h) => h.kind !== 'equal').every((h) => h.changeIndexes.includes(0))).toBe(
      true,
    );
  });
  it('R5 represents whitespace-only edits with exact code-point spans', () => {
    const hunks = alignRevision('😀  result', '😀 result');
    expect(hunks).toContainEqual({
      kind: 'replace',
      before: { start: 1, end: 3 },
      after: { start: 1, end: 2 },
    });
    expect(alignRevision('text', ' text ')).toEqual(
      expect.arrayContaining([
        { kind: 'insert', before: null, after: { start: 0, end: 1 } },
        { kind: 'insert', before: null, after: { start: 5, end: 6 } },
      ]),
    );
  });
  it('WR-07 aligns replacements with code-point offsets and reports unexplained changes', () => {
    const source = '😀  very large.';
    const revised = '😀  quite large.';
    const hunks = alignRevision(source, revised);
    expect(hunks).toContainEqual({
      kind: 'replace',
      before: { start: 3, end: 7 },
      after: { start: 3, end: 8 },
    });
    const result = attachChanges(source, revised, hunks, [
      { issueIds: ['i'], before: 'very', after: 'quite', rationale: 'Lý do' },
      { issueIds: ['j'], before: 'missing', after: 'absent', rationale: 'Lý do' },
    ]);
    expect(result.hunks.find((hunk) => hunk.kind === 'replace')?.changeIndexes).toEqual([0]);
    expect(result.unmatchedChanges).toHaveLength(1);
    expect(attachChanges(source, revised, hunks, []).hunks.some((hunk) => hunk.unexplained)).toBe(true);
  });

  it('AC-07 WR-06 WR-08 flags changed numbers, missing hedges and stronger claims', () => {
    const checks = meaningChecks('Results may suggest 5% (Smith, 2010).', 'Results prove 7%.', ['Results']);
    expect(checks.find((check) => check.id === 'numbers_preserved')?.status).toBe('fail');
    expect(checks.find((check) => check.id === 'citations_preserved')?.status).toBe('fail');
    expect(checks.find((check) => check.id === 'hedging_preserved')?.status).toBe('fail');
    expect(
      meaningChecks('It may work.', 'It works.', []).find((check) => check.id === 'hedging_preserved')
        ?.status,
    ).toBe('warn');
  });

  it('WR-07 distinguishes insertion and deletion with exact Unicode spans', () => {
    expect(alignRevision('😀  alpha beta.', '😀  alpha new beta.')).toContainEqual({
      kind: 'insert',
      before: null,
      after: { start: 9, end: 13 },
    });
    expect(alignRevision('😀  alpha new beta.', '😀  alpha beta.')).toContainEqual({
      kind: 'delete',
      before: { start: 9, end: 13 },
      after: null,
    });
  });

  it('AC-07 WR-06 WR-08 detects quantities, citations, negation, hedges and terms with grounded spans', () => {
    const source = '😀 No effect was observed; it may increase 3–5 mg (Smith et al., 2020), [3,5].';
    const revised = '😀 An effect was observed; it proves increase 10-20 mg [12].';
    const checks = meaningChecks(source, revised, ['effect', 'observed']);
    for (const id of [
      'numbers_preserved',
      'citations_preserved',
      'negation_preserved',
      'hedging_preserved',
    ]) {
      const check = checks.find((item) => item.id === id);
      expect(check?.status).toBe('fail');
      expect(check?.spans.length).toBeGreaterThan(0);
      for (const span of check?.spans ?? [])
        expect(sliceCp(span.side === 'source' ? source : revised, span.start, span.end)).not.toBe('');
    }
    expect(
      meaningChecks('😀 alpha 3.5% and 10-20 kg.', '😀 alpha 3.5% and 10-20 kg.', ['alpha']).every(
        (c) => c.status === 'pass',
      ),
    ).toBe(true);
    expect(
      meaningChecks('😀 no alpha and no beta.', '😀 no alpha and beta.', []).find(
        (c) => c.id === 'negation_preserved',
      )?.status,
    ).toBe('fail');
    expect(
      meaningChecks('😀 alpha.', '😀 beta.', ['alpha']).find((c) => c.id === 'preserve_terms'),
    ).toMatchObject({ status: 'fail', spans: [{ start: 2, end: 7, side: 'source' }] });
    expect(
      meaningChecks('A value.', 'A value 5%.', []).find((c) => c.id === 'numbers_preserved')?.status,
    ).toBe('fail');
    expect(
      meaningChecks('Smith et al. report results.', 'Results were reported.', []).find(
        (c) => c.id === 'citations_preserved',
      )?.status,
    ).toBe('fail');
    expect(
      meaningChecks('Results were reported.', 'Smith et al. report results.', []).find(
        (c) => c.id === 'citations_preserved',
      )?.status,
    ).toBe('fail');
  });
});
