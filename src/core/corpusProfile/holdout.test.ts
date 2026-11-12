import { describe, expect, it } from 'vitest';
import { testHoldout, type HoldoutPaper } from './holdout';
import { confoundChecks } from './confounds';
import { exampleProfileInputs } from './contract';
import { buildCorpusProfile } from './profile';

const rows = (values: number[]): HoldoutPaper[] => values.map((x) => ({ values: { x }, authorIds: [] }));
describe('C5b held-out validation', () => {
  it('C5b passes separable papers and fails identical distributions', () => {
    const buildT = rows([2, 3, 4]),
      buildC = rows([-2, -3, -4]);
    expect(testHoldout(['x'], buildT, buildC, rows([2, 3]), rows([-2, -3]), 42)).toMatchObject({
      auc: 1,
      ci95Low: 1,
      passed: true,
    });
    expect(testHoldout(['x'], buildT, buildC, rows([0, 0]), rows([0, 0]), 42)).toMatchObject({
      auc: 0.5,
      passed: false,
    });
  });
  it('C5b imputes using the build mean even with extreme held-out values', () => {
    const result = testHoldout(
      ['x'],
      rows([1, 2]),
      rows([-1, -2]),
      [{ values: { x: null }, authorIds: [] }, ...rows([10000])],
      rows([1]),
      4,
    );
    expect(result.auc).toBe(0.5);
  });
  it('C5b drops held-out papers sharing authors with the opposite build corpus', () => {
    const result = testHoldout(
      ['x'],
      [{ values: { x: 2 }, authorIds: ['a'] }],
      rows([-2]),
      rows([2]),
      [{ values: { x: -2 }, authorIds: ['a'] }],
      4,
    );
    expect(result).toMatchObject({ droppedForAuthorOverlap: 1, nControl: 0, auc: null, passed: false });
  });
  it('C5b reports total variation and missing topics', () => {
    const { target, control } = exampleProfileInputs();
    target.members.forEach((m) => {
      m.countries = ['VN'];
      m.stratum.year = 2024;
    });
    control.members.forEach((m) => {
      m.countries = ['US'];
      m.stratum.year = 2026;
    });
    expect(confoundChecks(target.members, control.members)).toMatchObject([
      { distance: 1 },
      { target: 'Not available', distance: null },
      { distance: 1 },
    ]);
  });
  it('C5b requires both minimums and a passing test for supported status', async () => {
    const holdout = {
      auc: 1,
      ci95Low: 1,
      ci95High: 1,
      nTarget: 2,
      nControl: 2,
      droppedForAuthorOverlap: 0,
      passed: true,
      rule: 'test',
    };
    const small = await buildCorpusProfile({ ...exampleProfileInputs(), seed: 1, now: new Date(0), holdout });
    expect(small.interpretationStatus).toBe('exploratory');
    const large = await buildCorpusProfile({
      ...exampleProfileInputs(150),
      seed: 1,
      now: new Date(0),
      holdout,
    });
    expect(large.interpretationStatus).toBe('supported');
  }, 60000);
});
