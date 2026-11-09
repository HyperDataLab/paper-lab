import type { Paper } from '../schemas/paper';
import {
  MeasurementProfileSchema,
  PROTOCOL_FIELDS,
  type ClassifyOutput,
  type Experiment,
  type ExtractionOutput,
  type MeasurementProfile,
  type MetricUsage,
  type ProfileField,
  type ProtocolField,
  type ReportedResult,
} from '../schemas/measurement';
import type { ExtractionUnit } from './plan';
import { cellContext, containsExact, createVerifier, splitUncertainty, type Verifier } from './verify';

/** Sections where a protocol detail could plausibly be stated; unread ones make a field NOT_CHECKED. */
const PROTOCOL_ROLES = ['methods', 'results', 'appendix', 'other'];

export interface UnitResult {
  unit: ExtractionUnit;
  output: ExtractionOutput | null;
}
export interface ProfileInput {
  paper: Paper;
  selectedSectionIds: string[];
  classification: ClassifyOutput;
  units: UnitResult[];
  model: string;
  promptVersion: string;
  generatedAt: string;
}

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
const RANK: Record<ProfileField['status'], number> = {
  CONTRADICTORY: 6,
  REPORTED: 5,
  HUMAN_EDITED: 5,
  DERIVED: 4,
  INFERRED: 3,
  NOT_APPLICABLE: 2,
  NOT_REPORTED: 1,
  NOT_CHECKED: 0,
};

/** The stronger field wins. Two different reported values stay flagged; code does not call them a contradiction. */
export function mergeFields(a: ProfileField, b: ProfileField): ProfileField {
  const [first, second] = RANK[b.status] > RANK[a.status] ? [b, a] : [a, b];
  const same =
    first.value !== null && second.value !== null && normalize(first.value) === normalize(second.value);
  const conflict =
    first.status === 'REPORTED' && second.status === 'REPORTED' && first.value !== null && !same;
  return {
    ...first,
    evidence_ids: same ? [...new Set([...first.evidence_ids, ...second.evidence_ids])] : first.evidence_ids,
    needs_review: first.needs_review || conflict,
  };
}

function verifyResult(
  raw: ExtractionOutput['results'][number],
  verifier: Verifier,
  ids: { experiment: string | null; metric: string | null; result: string },
): ReportedResult {
  const { value, uncertainty } = splitUncertainty(raw.value, raw.uncertainty);
  const evidence = verifier.resolve(raw.quote);
  const reasons: string[] = [];
  if (!evidence) reasons.push('source_not_found');
  let context = '';
  if (evidence?.cell) {
    const block = verifier.block(evidence.blockId);
    if (block) context = cellContext(block, evidence.cell.row, evidence.cell.column);
  } else if (evidence?.kind === 'table') reasons.push('cell_not_located');
  if (evidence?.needs_review) reasons.push('table_low_confidence');
  if (evidence) {
    if (!containsExact(evidence.source_excerpt, value)) reasons.push('value_not_in_source');
    if (uncertainty && !containsExact(evidence.source_excerpt, uncertainty))
      reasons.push('uncertainty_not_in_source');
    if (raw.unit && !containsExact(`${evidence.source_excerpt} ${context}`, raw.unit))
      reasons.push('unit_not_in_source');
  }
  const failed = reasons.some((reason) => reason !== 'table_low_confidence' && reason !== 'cell_not_located');
  return {
    id: ids.result,
    experiment_id: ids.experiment,
    metric_usage_id: ids.metric,
    system_or_baseline: raw.system_or_baseline,
    value,
    unit: raw.unit,
    uncertainty,
    condition: raw.condition,
    source_table_cell: evidence?.cell ? { blockId: evidence.blockId, ...evidence.cell } : null,
    status: failed ? 'INFERRED' : 'REPORTED',
    needs_review: reasons.length > 0,
    review_reasons: reasons,
    evidence_ids: evidence ? [evidence.id] : [],
  };
}

export function compatibleFields(a: ProfileField, b: ProfileField) {
  return !(
    a.status === 'REPORTED' &&
    b.status === 'REPORTED' &&
    a.value !== null &&
    b.value !== null &&
    normalize(a.value) !== normalize(b.value)
  );
}

export function mergeMetric(target: MetricUsage, next: MetricUsage) {
  target.aliases = [...new Set([...target.aliases, ...next.aliases])];
  target.construct_ids = [...new Set([...target.construct_ids, ...next.construct_ids])];
  target.experiment_ids = [...new Set([...target.experiment_ids, ...next.experiment_ids])];
  target.definition = mergeFields(target.definition, next.definition);
  target.formula_text = mergeFields(target.formula_text, next.formula_text);
  target.unit = mergeFields(target.unit, next.unit);
  target.direction = mergeFields(target.direction, next.direction);
  target.range = mergeFields(target.range, next.range);
  for (const key of ['input_data', 'procedure', 'data_source', 'aggregation'] as const)
    target.method[key] = mergeFields(target.method[key], next.method[key]);
  target.evidence_ids = fieldEvidence(target);
}

export function fieldEvidence(metric: MetricUsage) {
  return [
    ...new Set(
      [
        metric.definition,
        metric.formula_text,
        metric.unit,
        metric.direction,
        metric.range,
        ...Object.values(metric.method),
      ].flatMap((field) => field.evidence_ids),
    ),
  ];
}

/** AC-11: a field nothing reported is NOT_REPORTED only if the sections where it could appear were read. */
function applyScope(field: ProfileField, scope: string[], complete: boolean): ProfileField {
  if (field.status !== 'NOT_REPORTED' || field.needs_review) return field;
  return complete
    ? { ...field, search_scope: scope }
    : { ...field, status: 'NOT_CHECKED', search_scope: scope };
}

export function buildProfile(input: ProfileInput): MeasurementProfile {
  const { paper, classification, units } = input;
  const analysed = units.filter((item) => item.output).flatMap((item) => item.unit.sectionIds);
  const failed = units.filter((item) => !item.output).flatMap((item) => item.unit.sectionIds);
  const notSelected = paper.sections
    .filter((section) => !input.selectedSectionIds.includes(section.id))
    .map((section) => section.id);
  const blockIds = new Set(units.flatMap((item) => item.unit.blocks.map((block) => block.id)));
  const verifier = createVerifier(paper, blockIds);
  const survey = classification.paper_type === 'SURVEY_SLR';
  const typeEvidence = classification.quotes.flatMap((quote) => verifier.resolve(quote) ?? []);

  const constructs = new Map<string, MeasurementProfile['constructs'][number]>();
  const metrics: MetricUsage[] = [];
  const experiments: Experiment[] = [];
  const results: ReportedResult[] = [];
  const claims: MeasurementProfile['claims'] = [];
  const taxonomy: MeasurementProfile['taxonomy'] = [];
  let reviewMethod: MeasurementProfile['review_method'] = null;
  let inventedExperiments = 0;

  for (const { output } of units) {
    if (!output) continue;
    const constructIds = new Map<string, string>();
    for (const raw of output.constructs) {
      const key = normalize(raw.name);
      const found = raw.quotes.flatMap((quote) => verifier.resolve(quote)?.id ?? []);
      const existing = constructs.get(key);
      if (existing) existing.evidence_ids = [...new Set([...existing.evidence_ids, ...found])];
      else
        constructs.set(key, {
          id: `c-${constructs.size + 1}`,
          name: raw.name,
          description: raw.description,
          source_type: found.length ? 'author_statement' : 'ai_interpretation',
          evidence_ids: [...new Set(found)],
        });
      constructIds.set(raw.key, constructs.get(key)?.id ?? '');
    }
    const experimentIds = new Map<string, string>();
    if (survey) inventedExperiments += output.experiments.length + output.results.length;
    else
      for (const raw of output.experiments) {
        const protocol = Object.fromEntries(
          PROTOCOL_FIELDS.map((key) => [key, verifier.field(raw.protocol[key])]),
        ) as Record<ProtocolField, ProfileField>;
        const existing = experiments.find((item) => normalize(item.name) === normalize(raw.name));
        if (existing) {
          for (const key of PROTOCOL_FIELDS)
            existing.protocol[key] = mergeFields(existing.protocol[key], protocol[key]);
          experimentIds.set(raw.key, existing.id);
        } else {
          const id = `exp-${experiments.length + 1}`;
          experiments.push({ id, name: raw.name, protocol });
          experimentIds.set(raw.key, id);
        }
      }
    const metricIds = new Map<string, string>();
    for (const raw of output.metrics) {
      const usage: MetricUsage = {
        id: `mu-${metrics.length + 1}`,
        reported_name: raw.reported_name,
        normalized_label: normalize(raw.reported_name),
        aliases: raw.aliases,
        construct_ids: raw.construct_keys.flatMap((key) => constructIds.get(key) ?? []),
        experiment_ids: raw.experiment_keys.flatMap((key) => experimentIds.get(key) ?? []),
        definition: verifier.field(raw.definition),
        formula_text: verifier.field(raw.formula),
        unit: verifier.field(raw.unit),
        direction: verifier.field(raw.direction),
        range: verifier.field(raw.range),
        method: {
          input_data: verifier.field(raw.method.input_data),
          procedure: verifier.field(raw.method.procedure),
          data_source: verifier.field(raw.method.data_source),
          aggregation: verifier.field(raw.method.aggregation),
        },
        name_collision: false,
        evidence_ids: [],
      };
      usage.evidence_ids = fieldEvidence(usage);
      const sameName = metrics.filter((item) => item.normalized_label === usage.normalized_label);
      const match = sameName.find(
        (item) =>
          compatibleFields(item.definition, usage.definition) &&
          compatibleFields(item.unit, usage.unit) &&
          compatibleFields(item.formula_text, usage.formula_text),
      );
      if (match) {
        mergeMetric(match, usage);
        metricIds.set(raw.key, match.id);
      } else {
        if (sameName.length) {
          usage.name_collision = true;
          for (const item of sameName) item.name_collision = true;
        }
        metrics.push(usage);
        metricIds.set(raw.key, usage.id);
      }
    }
    if (!survey)
      for (const raw of output.results)
        results.push(
          verifyResult(raw, verifier, {
            result: `r-${results.length + 1}`,
            experiment: raw.experiment_key ? (experimentIds.get(raw.experiment_key) ?? null) : null,
            metric: raw.metric_key ? (metricIds.get(raw.metric_key) ?? null) : null,
          }),
        );
    for (const raw of output.claims) {
      const evidence = verifier.resolve(raw.quote);
      claims.push({
        id: `cl-${claims.length + 1}`,
        text: raw.text,
        status: evidence ? 'REPORTED' : 'INFERRED',
        needs_review: !evidence || evidence.needs_review,
        evidence_scope: null,
        linked_result_ids: [],
        linked_metric_ids: [],
        evidence_ids: evidence ? [evidence.id] : [],
      });
    }
    if (survey) {
      for (const raw of output.taxonomy)
        taxonomy.push({
          id: `tx-${taxonomy.length + 1}`,
          construct: raw.construct,
          metric: raw.metric,
          how_measured: verifier.field(raw.how_measured),
          domain: verifier.field(raw.domain),
          evidence_ids: [...new Set(raw.quotes.flatMap((quote) => verifier.resolve(quote)?.id ?? []))],
        });
      if (output.review_method) {
        const next = {
          search_strategy: verifier.field(output.review_method.search_strategy),
          inclusion_criteria: verifier.field(output.review_method.inclusion_criteria),
          synthesis: verifier.field(output.review_method.synthesis),
        };
        reviewMethod = reviewMethod
          ? {
              search_strategy: mergeFields(reviewMethod.search_strategy, next.search_strategy),
              inclusion_criteria: mergeFields(reviewMethod.inclusion_criteria, next.inclusion_criteria),
              synthesis: mergeFields(reviewMethod.synthesis, next.synthesis),
            }
          : next;
      }
    }
  }

  const relevantRead = paper.sections
    .filter((section) => PROTOCOL_ROLES.includes(section.role))
    .filter((section) =>
      paper.paragraphs.some((p) => p.sectionId === section.id && ['body', 'table', 'list'].includes(p.kind)),
    )
    .every((section) => analysed.includes(section.id));
  for (const experiment of experiments)
    for (const key of PROTOCOL_FIELDS) {
      experiment.protocol[key] = applyScope(experiment.protocol[key], analysed, relevantRead);
    }
  for (const metric of metrics) {
    for (const key of ['definition', 'formula_text', 'unit', 'direction', 'range'] as const)
      metric[key] = applyScope(metric[key], analysed, relevantRead);
    for (const key of ['input_data', 'procedure', 'data_source', 'aggregation'] as const)
      metric.method[key] = applyScope(metric.method[key], analysed, relevantRead);
  }

  return MeasurementProfileSchema.parse({
    schema_version: '1.0',
    paper_id: paper.id,
    title: paper.title,
    paper_type: classification.paper_type,
    paper_type_rationale: classification.rationale,
    paper_type_evidence_ids: [...new Set(typeEvidence.map((item) => item.id))],
    status: failed.length ? 'partial' : 'complete',
    generated_at: input.generatedAt,
    model_id: input.model,
    prompt_version: input.promptVersion,
    parser_version: paper.source.parserVersion ?? null,
    coverage: { analysed, failed, not_selected: notSelected },
    steps: { link: 'not_run', findings: 'not_run' },
    constructs: [...constructs.values()],
    metrics,
    experiments,
    results,
    claims,
    findings: [],
    taxonomy,
    review_method: reviewMethod,
    evidence: verifier.evidence(),
    discarded: {
      unverified_quotes: verifier.unverified(),
      invented_experiments: inventedExperiments,
      unsupported_findings: 0,
      invalid_links: 0,
    },
  });
}
