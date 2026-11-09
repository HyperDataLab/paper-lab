import type { MeasurementProfile, MetricUsage, ProfileField, ReportedResult } from '../schemas/measurement';
import { PROTOCOL_FIELDS } from '../schemas/measurement';

export type MeasurementRef =
  | {
      kind:
        | 'overview'
        | 'experiments'
        | 'unlinked'
        | 'claims'
        | 'constructs'
        | 'findings'
        | 'review'
        | 'taxonomy';
    }
  | {
      kind: 'experiment' | 'metric' | 'result' | 'claim' | 'construct' | 'finding' | 'taxonomyEntry';
      id: string;
    };

export interface MeasurementNode {
  /** Unique per position: the same result can sit under an experiment and under a claim. */
  id: string;
  label: string;
  count?: number;
  flagged: boolean;
  ref: MeasurementRef;
  children?: MeasurementNode[];
}

const metricFields = (metric: MetricUsage): ProfileField[] => [
  metric.definition,
  metric.formula_text,
  metric.unit,
  metric.direction,
  metric.range,
  ...Object.values(metric.method),
];
export const metricFlagged = (metric: MetricUsage) =>
  metricFields(metric).some((field) => field.needs_review);
const short = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const resultLabel = (result: ReportedResult) =>
  `${result.system_or_baseline}: ${result.value}${result.uncertainty ? ` ± ${result.uncertainty}` : ''}${result.unit ? ` ${result.unit}` : ''}`;

/** The profile as a tree: experiment → metric → result, plus claims, constructs, concerns and the review queue. */
export function buildMeasurementTree(profile: MeasurementProfile): MeasurementNode[] {
  const resultNode = (parent: string, result: ReportedResult): MeasurementNode => ({
    id: `${parent}/r:${result.id}`,
    label: resultLabel(result),
    flagged: result.needs_review,
    ref: { kind: 'result', id: result.id },
  });
  const metricNode = (parent: string, metric: MetricUsage, results: ReportedResult[]): MeasurementNode => ({
    id: `${parent}/m:${metric.id}`,
    label: metric.reported_name,
    count: results.length,
    flagged: metricFlagged(metric),
    ref: { kind: 'metric', id: metric.id },
    children: results.map((result) => resultNode(`${parent}/m:${metric.id}`, result)),
  });
  const experimentNodes = profile.experiments.map((experiment): MeasurementNode => {
    const id = `exp/e:${experiment.id}`;
    const results = profile.results.filter((result) => result.experiment_id === experiment.id);
    const metrics = profile.metrics.filter(
      (metric) =>
        metric.experiment_ids.includes(experiment.id) ||
        results.some((result) => result.metric_usage_id === metric.id),
    );
    const known = new Set(metrics.map((metric) => metric.id));
    return {
      id,
      label: experiment.name,
      count: results.length,
      flagged: PROTOCOL_FIELDS.some((key) => experiment.protocol[key].needs_review),
      ref: { kind: 'experiment', id: experiment.id },
      children: [
        ...metrics.map((metric) =>
          metricNode(
            id,
            metric,
            results.filter((result) => result.metric_usage_id === metric.id),
          ),
        ),
        ...results
          .filter((result) => !result.metric_usage_id || !known.has(result.metric_usage_id))
          .map((result) => resultNode(id, result)),
      ],
    };
  });

  const looseMetrics = profile.metrics.filter(
    (metric) =>
      metric.experiment_ids.length === 0 &&
      !profile.results.some((result) => result.metric_usage_id === metric.id && result.experiment_id),
  );
  const looseResults = profile.results.filter((result) => !result.experiment_id);
  const looseKnown = new Set(looseMetrics.map((metric) => metric.id));
  const unlinked: MeasurementNode[] = [
    ...looseMetrics.map((metric) =>
      metricNode(
        'loose',
        metric,
        looseResults.filter((result) => result.metric_usage_id === metric.id),
      ),
    ),
    ...looseResults
      .filter((result) => !result.metric_usage_id || !looseKnown.has(result.metric_usage_id))
      .map((result) => resultNode('loose', result)),
  ];

  const claimNodes = [...profile.claims]
    .sort((a, b) => b.linked_result_ids.length - a.linked_result_ids.length)
    .map((claim): MeasurementNode => {
      const id = `claims/c:${claim.id}`;
      return {
        id,
        label: short(claim.text),
        count: claim.linked_result_ids.length,
        flagged: claim.needs_review,
        ref: { kind: 'claim', id: claim.id },
        children: claim.linked_result_ids.flatMap((resultId) => {
          const result = profile.results.find((item) => item.id === resultId);
          return result ? [resultNode(id, result)] : [];
        }),
      };
    });

  const constructNodes = profile.constructs.map((construct): MeasurementNode => {
    const id = `constructs/k:${construct.id}`;
    const metrics = profile.metrics.filter((metric) => metric.construct_ids.includes(construct.id));
    return {
      id,
      label: construct.name,
      count: metrics.length,
      flagged: false,
      ref: { kind: 'construct', id: construct.id },
      children: metrics.map((metric) => metricNode(id, metric, [])),
    };
  });

  const review: MeasurementNode[] = [
    ...profile.metrics.filter(metricFlagged).map((metric) => metricNode('review', metric, [])),
    ...experimentNodes
      .filter((node) => node.flagged)
      .map((node) => ({ ...node, id: `review/${node.id}`, children: undefined })),
    ...profile.results.filter((result) => result.needs_review).map((result) => resultNode('review', result)),
    ...claimNodes
      .filter((node) => node.flagged)
      .map((node) => ({ ...node, id: `review/${node.id}`, children: undefined })),
  ];
  const root = (
    id: string,
    label: string,
    kind: 'experiments' | 'unlinked' | 'claims' | 'constructs' | 'findings' | 'review' | 'taxonomy',
    children: MeasurementNode[],
  ): MeasurementNode => ({ id, label, count: children.length, flagged: false, ref: { kind }, children });
  const survey = profile.paper_type === 'SURVEY_SLR';
  return [
    { id: 'overview', label: 'Tổng quan', flagged: false, ref: { kind: 'overview' } },
    ...(survey
      ? [
          root(
            'taxonomy',
            'Taxonomy được khảo sát',
            'taxonomy',
            profile.taxonomy.map((entry) => ({
              id: `taxonomy/t:${entry.id}`,
              label: `${entry.construct} · ${entry.metric}`,
              flagged: entry.how_measured.needs_review || entry.domain.needs_review,
              ref: { kind: 'taxonomyEntry' as const, id: entry.id },
            })),
          ),
        ]
      : [root('exp', 'Thí nghiệm', 'experiments', experimentNodes)]),
    ...(unlinked.length ? [root('loose', 'Chưa gắn thí nghiệm', 'unlinked', unlinked)] : []),
    root('claims', 'Claim của tác giả', 'claims', claimNodes),
    root('constructs', 'Thuộc tính đo', 'constructs', constructNodes),
    root(
      'findings',
      'Cảnh báo của AI',
      'findings',
      profile.findings.map((finding) => ({
        id: `findings/f:${finding.id}`,
        label: short(finding.explanation),
        flagged: false,
        ref: { kind: 'finding' as const, id: finding.id },
      })),
    ),
    root('review', 'Cần xem lại', 'review', review),
  ];
}

export function flattenMeasurementTree(nodes: MeasurementNode[]): MeasurementNode[] {
  return nodes.flatMap((node) => [node, ...flattenMeasurementTree(node.children ?? [])]);
}
