import { expect, it } from 'vitest';
import { examplePlan } from '../researchDesign/plan/examplePlan';
import { analyzeResults } from './analyze-results';
import { csv, designFixture } from './ar3-fixtures';
import { outputs } from './fixtures';
import { normalizeResultsLog, parseResultsLog } from './results-input';
import { contrastVerdict, falsificationRule, groundedInterpretation } from './results-interpretation';
import { correctP, mannWhitney, pairedT, summarize, welchT } from './statistics';

const hypothesis = outputs.S8.hypotheses[0];
if (!hypothesis) throw new Error('Missing hypothesis fixture');
const draft = { ...designFixture([hypothesis.id]), bank: null };
const plan = examplePlan();
plan.hypotheses[0] = {
  id: hypothesis.id,
  statement: hypothesis.statement,
  kind: 'directional',
  dependent: ['v-accuracy'],
  independent: [],
};
plan.metrics = plan.metrics.slice(0, 1).map((metric) => ({ ...metric, name: 'Agreement' }));
plan.datasets = plan.datasets.map((dataset) => ({ ...dataset, name: 'Suite' }));
plan.conditions = plan.conditions
  .filter((c) => c.id !== 'c-dense')
  .map((c) => ({
    ...c,
    name: c.baseline ? 'Control' : 'Calibration',
  }));
plan.runMatrix = { ...plan.runMatrix, conditions: ['c-bm25', 'c-rerank'], seeds: [0, 1, 2], expectedRuns: 6 };
plan.analyses = plan.analyses.map((analysis) => ({
  ...analysis,
  hypothesis: hypothesis.id,
  conditions: ['c-rerank', 'c-bm25'],
  parameters: {},
}));

it('S12 parses CSV and JSON and maps names or SRD identifiers into the frozen grid', () => {
  const parsed = parseResultsLog(csv, 'csv');
  expect(parseResultsLog(`\uFEFF${JSON.stringify(parsed)}`, 'json')).toEqual(parsed);
  expect(
    parseResultsLog(
      'runId,condition,dataset,metrics,notes\r\n"run,a",Control,Suite,"{""Agreement"":1e-2}","line one\nline two"',
      'csv',
    ),
  ).toEqual({
    runs: [{ runId: 'run,a', condition: 'Control', dataset: 'Suite', metrics: { Agreement: 0.01 } }],
    notes: 'line one\nline two',
  });
  const normalized = normalizeResultsLog(parsed, draft, plan);
  expect(normalized.runs[0]).toMatchObject({
    condition: 'c-bm25',
    dataset: 'd-main',
    metrics: { 'm-accuracy': 1 },
  });
  expect(normalizeResultsLog(normalized, draft, plan)).toEqual(normalized);
  expect(() =>
    normalizeResultsLog(parseResultsLog(csv.replace('Agreement', 'fabricated'), 'csv'), draft, plan),
  ).toThrow();
  expect(() =>
    normalizeResultsLog(parseResultsLog(csv.replace('Calibration', 'Unplanned'), 'csv'), draft, plan),
  ).toThrow();
  expect(() =>
    normalizeResultsLog(parseResultsLog(csv.replace('Suite,1,2', 'Suite,0,2'), 'csv'), draft, plan),
  ).toThrow('duplicate seed');
  for (const malformed of [
    '"bad quote',
    csv.replace('0,1', '0,Infinity'),
    csv.replace('0,1', '0,0xff'),
    `${csv},extra`,
  ])
    expect(() => parseResultsLog(malformed, 'csv')).toThrow();
});

it('S12 computes sample SD, Welch, seed-paired t and Mann–Whitney against known values', () => {
  expect(summarize([])).toEqual({ n: 0, mean: null, sd: null });
  expect(summarize([1, 2, 3])).toEqual({ n: 3, mean: 2, sd: 1 });
  expect(summarize([1])).toEqual({ n: 1, mean: 1, sd: null });
  const welch = welchT([4, 5, 6], [1, 2, 3]);
  expect(welch?.statistic).toBeCloseTo(3.674234614, 8);
  expect(welch?.p).toBeCloseTo(0.021311641, 8);
  expect(welchT([1, 1], [0, 0])).toBeNull();
  const paired = pairedT([3, 6, 9], [1, 2, 3]);
  expect(paired?.statistic).toBeCloseTo(2 * Math.sqrt(3), 10);
  expect(paired?.p).toBeCloseTo(1 - Math.sqrt(6 / 7), 10);
  expect(pairedT([1], [0, 2])).toBeNull();
  expect(mannWhitney([4, 5, 6], [1, 2, 3])).toMatchObject({ statistic: 9, p: 0.1, exact: true });
  const tied = mannWhitney([2, 2, 2], [1, 1, 1]);
  expect(tied?.statistic).toBe(9);
  expect(tied?.p).toBeCloseTo(0.0468541776, 7);
  expect(correctP([0.01, 0.04, 0.03, null], 'holm')).toEqual([0.04, 0.09, 0.09, null]);
  expect(correctP([0.01, 0.04, 0.03], 'bonferroni')).toEqual([0.03, 0.12, 0.09]);
  expect(correctP([0.01, 0.04, 0.03], 'fdr_bh')).toEqual([0.03, 0.04, 0.04]);
});

it('S12 runs the locked analysis, preserves missing tests and grounds narrative numbers', () => {
  const log = normalizeResultsLog(parseResultsLog(csv, 'csv'), draft, plan);
  const computed = analyzeResults(log, plan, [hypothesis]);
  expect(computed.table).toEqual([
    { dataset: 'Suite', condition: 'Control', metric: 'Agreement', n: 3, mean: 2, sd: 1 },
    { dataset: 'Suite', condition: 'Calibration', metric: 'Agreement', n: 3, mean: 8, sd: 2 },
  ]);
  const test = computed.tests[0];
  expect(test).toMatchObject({ verdict: 'supported', reason: null });
  expect(groundedInterpretation(`Mean là 8 với p = ${test?.p}.`, computed)).toBe(true);
  expect(groundedInterpretation('Mean là 8.21.', computed)).toBe(false);
  expect(groundedInterpretation('Mean là 8e9.', computed)).toBe(false);
  expect(groundedInterpretation('Mean là .8.', computed)).toBe(false);
  const changed = structuredClone(plan);
  changed.analyses = changed.analyses.map((entry) => ({ ...entry, method: 'anova_oneway' }));
  expect(analyzeResults(log, changed, [hypothesis]).tests[0]).toMatchObject({
    p: null,
    corrected: null,
    verdict: 'inconclusive',
    reason: 'unsupported_test',
  });
  changed.analyses = changed.analyses.map((entry) => ({ ...entry, method: 'ttest_paired' }));
  const reverse = { ...log, runs: [...log.runs].reverse() };
  expect(analyzeResults(reverse, changed, [hypothesis]).tests[0]?.p).toBe(
    analyzeResults(log, changed, [hypothesis]).tests[0]?.p,
  );
  expect(analyzeResults({ runs: log.runs.slice(1) }, changed, [hypothesis]).tests[0]).toMatchObject({
    p: null,
    reason: 'missing_results',
    verdict: 'inconclusive',
  });
});

it('S12 verdicts use the preregistered criterion with uncertainty on unsupported and mixed outcomes', () => {
  const rule = falsificationRule(hypothesis);
  expect(rule).toEqual({ direction: 1, threshold: 0 });
  expect(contrastVerdict(rule, 1, 0.01, 0.05)).toBe('supported');
  expect(contrastVerdict(rule, -1, 0.01, 0.05)).toBe('refuted');
  expect(contrastVerdict(rule, -1, 0.1, 0.05)).toBe('inconclusive');
  expect(
    falsificationRule({ ...hypothesis, falsification: { criterion: 'effect ≤ 3', threshold: 3 } }),
  ).toEqual({ direction: 1, threshold: 3 });
  expect(
    falsificationRule({ ...hypothesis, falsification: { criterion: 'effect ≤ 3', threshold: 2 } }),
  ).toBeNull();
  expect(
    falsificationRule({
      ...hypothesis,
      falsification: {
        ...hypothesis.falsification,
        criterion: 'Agreement does not increase unless the intervention changes.',
      },
    }),
  ).toBeNull();
});
