import type { ExperimentPlan } from '../researchDesign/plan/schema';
import type { Hypothesis } from './contracts';
import type { ComputedResults, ResultsLog, ResultsTest } from './results-contract';
import { contrastVerdict, falsificationRule } from './results-interpretation';
import { correctP, mannWhitney, pairedT, summarize, welchT } from './statistics';

const rounded = (n: number | null) => (n === null ? null : Number(n.toPrecision(9)));
type Sample = { seed?: number; value: number };
export function analyzeResults(
  log: ResultsLog,
  plan: ExperimentPlan,
  hypotheses: Hypothesis[],
): ComputedResults {
  const grid = plan.runMatrix;
  const buckets = new Map<string, ResultsLog['runs']>();
  const key = (dataset: string, condition: string) => JSON.stringify([dataset, condition]);
  for (const run of log.runs) {
    const id = key(run.dataset, run.condition);
    const group = buckets.get(id) ?? [];
    group.push(run);
    buckets.set(id, group);
  }
  const sample = (dataset: string, condition: string, metric: string): Sample[] =>
    (buckets.get(key(dataset, condition)) ?? []).flatMap((run) => {
      const value = run.metrics[metric];
      return value === undefined ? [] : [{ seed: run.seed, value }];
    });
  const conditionName = (id: string) => plan.conditions.find((c) => c.id === id)?.name ?? id;
  const datasetName = (id: string) => plan.datasets.find((d) => d.id === id)?.name ?? id;
  const table = grid.datasets.flatMap((dataset) =>
    grid.conditions.flatMap((condition) =>
      plan.metrics.map((metric) => {
        const { n, mean, sd } = summarize(sample(dataset, condition, metric.id).map((item) => item.value));
        return {
          dataset: datasetName(dataset),
          condition: conditionName(condition),
          metric: metric.name,
          n,
          mean: rounded(mean),
          sd: rounded(sd),
        };
      }),
    ),
  );
  const sourceIds = new Map(plan.context?.autoresearch?.hypotheses.map(({ id, sourceId }) => [id, sourceId]));
  const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
  type Analysis = ExperimentPlan['analyses'][number];
  const compare = (
    analysis: Analysis,
    rows: [Sample[], Sample[]],
    rule: ReturnType<typeof falsificationRule>,
  ) => {
    const { method, missingPolicy, parameters } = analysis;
    if (!['ttest_welch', 'ttest_paired', 'mann_whitney'].includes(method))
      return { result: null, reason: 'unsupported_test' };
    if (
      Object.keys(parameters).length &&
      !(Object.keys(parameters).length === 1 && parameters.alternative === 'two-sided')
    )
      return { result: null, reason: 'unsupported_parameters' };
    const [left, right] = rows;
    const full = (items: Sample[]) =>
      items.length === grid.seeds.length &&
      (items.every(({ seed }) => seed === undefined) ||
        grid.seeds.every((seed) => items.some((s) => s.seed === seed)));
    if (missingPolicy === 'fail' && (!full(left) || !full(right)))
      return { result: null, reason: 'missing_results' };
    if (method === 'ttest_paired') {
      const rightBySeed = new Map(right.map(({ seed, value }) => [seed, value]));
      const pairs = left.flatMap(({ seed, value }) => {
        const other = seed === undefined ? undefined : rightBySeed.get(seed);
        return other === undefined ? [] : [{ value, other }];
      });
      if (
        !pairs.length ||
        (missingPolicy === 'fail' && (pairs.length !== left.length || pairs.length !== right.length))
      )
        return { result: null, reason: 'unpaired_seeds' };
      return {
        result: pairedT(
          pairs.map((p) => p.value),
          pairs.map((p) => p.other),
          rule?.threshold,
        ),
        reason: pairs.length < Math.max(left.length, right.length) ? 'incomplete_pairs' : null,
      };
    }
    const a = left.map((item) => item.value);
    const b = right.map((item) => item.value);
    if (method === 'ttest_welch') return { result: welchT(a, b, rule?.threshold), reason: null };
    const result = mannWhitney(a, b);
    return { result, reason: result && !result.exact ? 'asymptotic' : null };
  };
  const pending = plan.analyses.flatMap((analysis) => {
    const hypothesisId = sourceIds.get(analysis.hypothesis ?? '') ?? analysis.hypothesis;
    const hypothesis = hypothesisId ? byId.get(hypothesisId) : undefined;
    if (!hypothesis) return [];
    const criterion = falsificationRule(hypothesis);
    // A rank test can only decide a pre-registered rank contrast with a zero null.
    const rule =
      analysis.method === 'mann_whitney' &&
      (criterion?.threshold !== 0 || !/\b(?:rank|superiority)\b/iu.test(hypothesis.estimand))
        ? null
        : criterion;
    const linked = new Set(
      plan.variables.filter((v) => analysis.variables.includes(v.id)).map((v) => v.metric),
    );
    const metrics = plan.metrics.filter((metric) => linked.has(metric.id));
    return grid.datasets.flatMap((dataset) =>
      (metrics.length ? metrics : [null]).map((metric) => {
        const [left, right] = analysis.conditions;
        const { result, reason } =
          metric && left && right
            ? compare(analysis, [sample(dataset, left, metric.id), sample(dataset, right, metric.id)], rule)
            : {
                result: null,
                reason: ['ttest_welch', 'ttest_paired', 'mann_whitney'].includes(analysis.method)
                  ? 'missing_contrast'
                  : 'unsupported_test',
              };
        return {
          row: {
            hypothesisId: hypothesis.id,
            test: analysis.method,
            dataset: datasetName(dataset),
            metric: metric?.name ?? null,
            conditions: analysis.conditions.map(conditionName),
            statistic: rounded(result?.statistic ?? null),
            p: rounded(result?.p ?? null),
            reason: reason ?? (!result ? 'insufficient_data' : !rule ? 'criterion_needs_review' : null),
          },
          p: result?.p ?? null,
          effect: result?.effect ?? null,
          rule,
          analysis,
        };
      }),
    );
  });
  const adjusted = new Map<number, number | null>();
  for (const method of new Set(pending.map(({ analysis }) => analysis.correction))) {
    const family = pending.flatMap((entry, index) =>
      entry.analysis.correction === method ? [{ entry, index }] : [],
    );
    const values = correctP(
      family.map(({ entry }) => entry.p),
      method,
    );
    family.forEach(({ index }, i) => adjusted.set(index, values[i] ?? null));
  }
  const tests: ResultsTest[] = pending.map(({ row, effect, rule, analysis }, i) => {
    const corrected = adjusted.get(i) ?? null;
    return {
      ...row,
      corrected: rounded(corrected),
      verdict: contrastVerdict(rule, effect, corrected, analysis.alpha),
    };
  });
  return { table, tests };
}
