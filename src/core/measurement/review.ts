import {
  MeasurementProfileSchema,
  type MeasurementDecision,
  type MeasurementProfile,
} from '../schemas/measurement';

type AnyItem = Record<string, unknown>;

/** Latest decision for each item and field in one run; `reopen` clears it. */
export function latestDecisions(decisions: MeasurementDecision[], runId: string) {
  const latest = new Map<string, MeasurementDecision>();
  for (const decision of decisions)
    if (decision.run_id === runId) latest.set(`${decision.item_id}|${decision.field ?? ''}`, decision);
  return [...latest.values()].filter((decision) => decision.decision !== 'reopen');
}

function isField(value: unknown): value is { value: string | null; status: string; needs_review: boolean } {
  return typeof value === 'object' && value !== null && 'status' in value && 'evidence_ids' in value;
}

function holderOf(item: AnyItem, path: string) {
  const keys = path.split('.');
  const last = keys.pop();
  let holder: unknown = item;
  for (const key of keys) holder = (holder as AnyItem | undefined)?.[key];
  return last && typeof holder === 'object' && holder !== null
    ? { holder: holder as AnyItem, key: last }
    : null;
}

function edit(item: AnyItem, path: string, value: string | null) {
  const found = holderOf(item, path);
  if (!found || !(found.key in found.holder)) return;
  const current = found.holder[found.key];
  if (isField(current))
    found.holder[found.key] = {
      ...current,
      value,
      status: current.status === 'REPORTED' ? 'REPORTED' : 'INFERRED',
      needs_review: false,
    };
  else {
    found.holder[found.key] = value;
    if ('needs_review' in item) item.needs_review = false;
  }
}

function accept(item: AnyItem, path: string | null) {
  if (path) {
    const found = holderOf(item, path);
    const current = found?.holder[found.key];
    if (found && isField(current)) found.holder[found.key] = { ...current, needs_review: false };
    return;
  }
  for (const value of Object.values(item)) {
    if (isField(value)) value.needs_review = false;
    else if (typeof value === 'object' && value !== null && !Array.isArray(value))
      accept(value as AnyItem, null);
  }
  if ('needs_review' in item) item.needs_review = false;
}

function allItems(profile: MeasurementProfile): AnyItem[] {
  return [
    ...profile.constructs,
    ...profile.metrics,
    ...profile.experiments,
    ...profile.results,
    ...profile.claims,
    ...profile.findings,
    ...profile.taxonomy,
  ];
}

/**
 * The profile as a person left it. The AI original is never touched (AC-07). With `keepRejected`, rejected items
 * stay so the review screen can show and undo them; exports leave them out.
 */
export function reviewedProfile(
  original: MeasurementProfile,
  decisions: MeasurementDecision[],
  runId: string,
  options: { keepRejected?: boolean } = {},
): MeasurementProfile {
  const profile = structuredClone(original);
  const latest = latestDecisions(decisions, runId);
  const items = new Map(allItems(profile).map((item) => [item.id as string, item]));
  for (const decision of latest) {
    const item = items.get(decision.item_id);
    if (!item) continue;
    if (decision.decision === 'accept') accept(item, decision.field);
    if (decision.decision === 'edit' && decision.field) edit(item, decision.field, decision.new_value);
  }
  if (options.keepRejected) return MeasurementProfileSchema.parse(profile);
  const rejected = new Set(
    latest.filter((item) => item.decision === 'reject' && item.field === null).map((item) => item.item_id),
  );
  const keep = <T extends { id: string }>(list: T[]) => list.filter((item) => !rejected.has(item.id));
  profile.constructs = keep(profile.constructs);
  profile.metrics = keep(profile.metrics);
  profile.experiments = keep(profile.experiments);
  profile.results = keep(profile.results);
  profile.claims = keep(profile.claims);
  profile.findings = keep(profile.findings);
  profile.taxonomy = keep(profile.taxonomy);
  for (const result of profile.results) {
    if (result.metric_usage_id && rejected.has(result.metric_usage_id)) result.metric_usage_id = null;
    if (result.experiment_id && rejected.has(result.experiment_id)) result.experiment_id = null;
  }
  for (const metric of profile.metrics)
    metric.experiment_ids = metric.experiment_ids.filter((id) => !rejected.has(id));
  for (const claim of profile.claims) {
    claim.linked_result_ids = claim.linked_result_ids.filter((id) => !rejected.has(id));
    claim.linked_metric_ids = claim.linked_metric_ids.filter((id) => !rejected.has(id));
  }
  return MeasurementProfileSchema.parse(profile);
}

/** Share of filled-in fields that point at evidence found in the paper. */
export function evidenceRate(profile: MeasurementProfile) {
  const fields = [
    ...profile.metrics.flatMap((metric) => [
      metric.definition,
      metric.formula_text,
      metric.unit,
      metric.direction,
      metric.range,
      ...Object.values(metric.method),
    ]),
    ...profile.experiments.flatMap((experiment) => Object.values(experiment.protocol)),
  ].filter((field) => field.value !== null);
  const results = profile.results;
  const total = fields.length + results.length;
  const withEvidence =
    fields.filter((field) => field.evidence_ids.length > 0).length +
    results.filter((result) => result.evidence_ids.length > 0).length;
  return { withEvidence, total, rate: total ? withEvidence / total : null };
}

export function reviewQueueSize(profile: MeasurementProfile) {
  const fields = [
    ...profile.metrics.flatMap((metric) => [
      metric.definition,
      metric.formula_text,
      metric.unit,
      metric.direction,
      metric.range,
      ...Object.values(metric.method),
    ]),
    ...profile.experiments.flatMap((experiment) => Object.values(experiment.protocol)),
  ];
  return (
    fields.filter((field) => field.needs_review).length +
    profile.results.filter((result) => result.needs_review).length +
    profile.claims.filter((claim) => claim.needs_review).length
  );
}
