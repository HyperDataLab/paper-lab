import { csvRows } from '../corpus/searchImport';
import type { ExperimentPlan } from '../researchDesign/plan/schema';
import type { ExperimentDesign } from './experiment-design';
import { resultsLogSchema, type ResultsLog } from './results-contract';

export class ResultsLogError extends Error {}
const decimal = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/iu;
const metadata = ['runId', 'condition', 'dataset', 'seed', 'notes', 'metrics'];
export function parseResultsLog(raw: string, format: 'json' | 'csv'): ResultsLog {
  const input = raw.replace(/^\uFEFF/u, '');
  if (format === 'json') return resultsLogSchema.parse(JSON.parse(input));
  const [header, ...rows] = csvRows(input, true);
  const keys = header?.map((key) => key.trim()) ?? [];
  if (
    keys.some((key) => !key) ||
    new Set(keys).size !== keys.length ||
    !['runId', 'condition', 'dataset'].every((key) => keys.includes(key))
  )
    throw new ResultsLogError('CSV requires unique columns runId, condition and dataset');
  const metricKeys = keys.filter((key) => !metadata.includes(key));
  if (keys.includes('metrics') && metricKeys.length)
    throw new ResultsLogError('Use either the metrics column or separate metric columns');
  const notes = new Set<string>();
  const runs = rows.map((row, i) => {
    if (row.length !== keys.length)
      throw new ResultsLogError(`CSV row ${i + 2} has a different column count`);
    const read = (key: string) => row[keys.indexOf(key)]?.trim();
    const entryNotes = read('notes');
    if (entryNotes) notes.add(entryNotes);
    const seed = read('seed');
    if (seed && !/^\d+$/u.test(seed)) throw new ResultsLogError(`Invalid seed at CSV row ${i + 2}`);
    const metrics = read('metrics');
    return {
      runId: read('runId'),
      condition: read('condition'),
      dataset: read('dataset'),
      ...(seed && { seed: Number(seed) }),
      metrics: metrics
        ? (JSON.parse(metrics) as unknown)
        : Object.fromEntries(
            metricKeys.flatMap((key) => {
              const value = read(key);
              if (!value) return [];
              if (!decimal.test(value))
                throw new ResultsLogError(`Invalid metric at CSV row ${i + 2}: ${key}`);
              return [[key, Number(value)]];
            }),
          ),
    };
  });
  return resultsLogSchema.parse({ runs, ...(notes.size && { notes: [...notes].join('\n') }) });
}

function aliases<T extends { id: string; name: string }>(items: T[], keys: (item: T) => string[]) {
  const index = new Map<string, Set<string>>();
  for (const item of items) {
    for (const key of keys(item)) {
      const matches = index.get(key) ?? new Set<string>();
      matches.add(item.id);
      index.set(key, matches);
    }
  }
  return (key: string) => {
    const match = index.get(key);
    if (match?.size === 1) return [...match][0];
    throw new ResultsLogError(`Unknown or ambiguous planned identifier: ${key}`);
  };
}

/** SRD supplies plan IDs and MLflow keys. A file may use the unambiguous S10 names. */
function plannedIdentifiers(design: ExperimentDesign, plan: ExperimentPlan) {
  const grid = plan.runMatrix;
  const condition = aliases(
    plan.conditions.filter((c) => grid.conditions.includes(c.id)),
    (c) => [c.id, c.name],
  );
  const dataset = aliases(
    plan.datasets.filter((d) => grid.datasets.includes(d.id)),
    (d) => [d.id, d.name],
  );
  const metric = aliases(plan.metrics, (m) => [m.id, m.key, m.name]);
  const requireCoverage = (rows: { name: string }[], resolve: (name: string) => string | undefined) => {
    const mapped = new Set(rows.map(({ name }) => resolve(name)));
    if (mapped.size !== rows.length)
      throw new ResultsLogError('Planned names must resolve to distinct locked IDs');
  };
  requireCoverage(design.conditions, condition);
  requireCoverage(design.datasets, dataset);
  requireCoverage(design.metrics, metric);
  return { condition, dataset, metric };
}

export function checkResultCoverage(design: ExperimentDesign, plan: ExperimentPlan) {
  plannedIdentifiers(design, plan);
}

export function normalizeResultsLog(
  log: ResultsLog,
  design: ExperimentDesign,
  plan: ExperimentPlan,
): ResultsLog {
  const { condition, dataset, metric } = plannedIdentifiers(design, plan);
  const grid = plan.runMatrix;
  const runIds = new Set<string>();
  const cells = new Set<string>();
  const runs = log.runs.map((run) => {
    const conditionId = condition(run.condition);
    const datasetId = dataset(run.dataset);
    if (!conditionId || !datasetId || runIds.has(run.runId))
      throw new ResultsLogError(`Invalid or duplicate run: ${run.runId}`);
    runIds.add(run.runId);
    if (run.seed !== undefined) {
      const cell = JSON.stringify([conditionId, datasetId, run.seed]);
      if (!grid.seeds.includes(run.seed) || cells.has(cell))
        throw new ResultsLogError(`Unexpected or duplicate seed for run: ${run.runId}`);
      cells.add(cell);
    }
    const metrics = new Map<string, number>();
    for (const [key, value] of Object.entries(run.metrics)) {
      const id = metric(key);
      if (!id || metrics.has(id)) throw new ResultsLogError(`Duplicate metric: ${key}`);
      metrics.set(id, value);
    }
    return { ...run, condition: conditionId, dataset: datasetId, metrics: Object.fromEntries(metrics) };
  });
  return { ...log, runs };
}
