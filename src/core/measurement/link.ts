import type {
  FindingsOutput,
  LinkOutput,
  MeasurementProfile,
  MetricUsage,
  ProfileField,
} from '../schemas/measurement';
import { compatibleFields, mergeMetric } from './build';

function canMerge(a: MetricUsage, b: MetricUsage) {
  const pairs: [ProfileField, ProfileField][] = [
    [a.definition, b.definition],
    [a.unit, b.unit],
    [a.formula_text, b.formula_text],
  ];
  return pairs.every(([x, y]) => compatibleFields(x, y));
}

/**
 * Applies the model's linking proposal. Code keeps only links between items that exist, never replaces a link
 * already established from the text, and never merges usages whose reported definitions differ.
 */
export function applyLinks(input: MeasurementProfile, output: LinkOutput): MeasurementProfile {
  const profile = structuredClone(input);
  let invalid = 0;
  const redirect = new Map<string, string>();
  const resolveMetric = (id: string) => {
    let current = id;
    while (redirect.has(current)) current = redirect.get(current) ?? current;
    return current;
  };
  const metricById = (id: string) => profile.metrics.find((item) => item.id === resolveMetric(id));

  for (const merge of output.metric_merges) {
    const [first, ...rest] = merge.ids;
    const target = first === undefined ? undefined : metricById(first);
    if (!target) {
      invalid += merge.ids.length;
      continue;
    }
    for (const id of rest) {
      const other = metricById(id);
      if (!other) invalid++;
      else if (other === target) continue;
      else if (!canMerge(target, other)) {
        invalid++;
        target.name_collision = true;
        other.name_collision = true;
      } else {
        const alias = other.reported_name;
        mergeMetric(target, other);
        if (alias !== target.reported_name && !target.aliases.includes(alias)) target.aliases.push(alias);
        redirect.set(other.id, target.id);
        profile.metrics = profile.metrics.filter((item) => item !== other);
      }
    }
  }
  for (const result of profile.results)
    if (result.metric_usage_id) result.metric_usage_id = resolveMetric(result.metric_usage_id);

  const experiments = new Set(profile.experiments.map((item) => item.id));
  for (const link of output.result_links) {
    const result = profile.results.find((item) => item.id === link.result_id);
    if (!result) {
      invalid++;
      continue;
    }
    if (link.metric_id !== null) {
      const metric = metricById(link.metric_id);
      if (!metric) invalid++;
      else result.metric_usage_id ??= metric.id;
    }
    if (link.experiment_id !== null) {
      if (!experiments.has(link.experiment_id)) invalid++;
      else result.experiment_id ??= link.experiment_id;
    }
  }
  for (const link of output.metric_experiments) {
    const metric = metricById(link.metric_id);
    if (!metric || !experiments.has(link.experiment_id)) invalid++;
    else if (!metric.experiment_ids.includes(link.experiment_id))
      metric.experiment_ids.push(link.experiment_id);
  }
  for (const result of profile.results) {
    const metric = result.metric_usage_id ? metricById(result.metric_usage_id) : undefined;
    if (metric && result.experiment_id && !metric.experiment_ids.includes(result.experiment_id))
      metric.experiment_ids.push(result.experiment_id);
  }

  for (const link of output.claim_links) {
    const claim = profile.claims.find((item) => item.id === link.claim_id);
    if (!claim) {
      invalid++;
      continue;
    }
    // FR-10: a claim is linked only to results whose numbers were found in the paper.
    const results = link.result_ids.filter((id) => {
      const ok = profile.results.some(
        (item) => item.id === id && item.status === 'REPORTED' && item.evidence_ids.length > 0,
      );
      if (!ok) invalid++;
      return ok;
    });
    const metrics = link.metric_ids.flatMap((id) => {
      const metric = metricById(id);
      if (!metric) invalid++;
      return metric ? [metric.id] : [];
    });
    claim.linked_result_ids = [...new Set([...claim.linked_result_ids, ...results])];
    claim.linked_metric_ids = [...new Set([...claim.linked_metric_ids, ...metrics])];
    if (results.length) claim.evidence_scope = link.evidence_scope;
  }
  profile.discarded.invalid_links += invalid;
  return profile;
}

function knownItems(profile: MeasurementProfile) {
  return new Set([
    ...profile.metrics.map((item) => item.id),
    ...profile.experiments.map((item) => item.id),
    ...profile.results.map((item) => item.id),
    ...profile.claims.map((item) => item.id),
    ...profile.constructs.map((item) => item.id),
    ...profile.taxonomy.map((item) => item.id),
  ]);
}

/** A concern survives only if it points at evidence or items that exist; otherwise nothing supports it. */
export function applyFindings(input: MeasurementProfile, output: FindingsOutput): MeasurementProfile {
  const profile = structuredClone(input);
  const items = knownItems(profile);
  const evidence = new Set(profile.evidence.map((item) => item.id));
  const survey = profile.paper_type === 'SURVEY_SLR';
  let unsupported = 0;
  for (const raw of output.findings) {
    const evidenceIds = [...new Set(raw.evidence_ids.filter((id) => evidence.has(id)))];
    const related = [...new Set(raw.related_item_ids.filter((id) => items.has(id)))];
    if ((!evidenceIds.length && !related.length) || (survey && raw.type === 'protocol_incompleteness')) {
      unsupported++;
      continue;
    }
    profile.findings.push({
      ...raw,
      id: `f-${profile.findings.length + 1}`,
      evidence_ids: evidenceIds,
      related_item_ids: related,
    });
  }
  profile.discarded.unsupported_findings += unsupported;
  return profile;
}
