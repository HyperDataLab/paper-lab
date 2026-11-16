import { latestDecisions } from '../measurement/review';
import {
  ExperimentFactsSchema,
  type ExperimentFact,
  type MeasurementsRecord,
  type Paper,
  type PaperModel,
} from '../schemas';

type Kind = ExperimentFact['kind'];
type Cell = NonNullable<ExperimentFact['tableCell']>;

/** Project the newest run. Evidence and sentence offsets are both code points. */
export function projectExperimentFacts({
  paperId,
  modelEtag,
  model,
  record,
  paper,
  now,
}: {
  paperId: string;
  modelEtag: string;
  model: PaperModel;
  record: MeasurementsRecord;
  paper: Paper;
  now: Date;
}) {
  const run = [...record.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!run) throw new Error('Cannot project experiment facts without a measurement run');
  // `paperId` is the published id; the record and run belong to the local paper.
  if (record.paperId !== paper.id || run.profile.paper_id !== paper.id)
    throw new Error('Paper IDs do not match');
  const decisions = latestDecisions(record.decisions, run.id);
  const dropped = { noAnchor: 0, rejected: 0 };
  const facts: ExperimentFact[] = [];
  const index = new Map<string, ExperimentFact>();
  const evidence = new Map(run.profile.evidence.map((entry) => [entry.id, entry]));
  const blocks = new Map(model.document.blocks.map((block) => [block.id, block]));
  const paragraphs = new Map(paper.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  function cell(blockId: string, row: number, column: number): Cell | null {
    const paragraph = paragraphs.get(blockId);
    const block = blocks.get(blockId);
    const table = paragraph?.table;
    if (
      !table ||
      !block ||
      block.text !== paragraph.text ||
      !table.rows[row]?.cells.some((c) => c.column === column)
    )
      return null;
    return {
      blockId,
      row,
      column,
      rowHeader: row > 0 ? (table.rows[row]?.cells.find((c) => c.column === 0)?.text ?? null) : null,
      columnHeader: row > 0 ? (table.rows[0]?.cells.find((c) => c.column === column)?.text ?? null) : null,
    };
  }
  function anchor(ids: string[], source: { blockId: string; row: number; column: number } | null = null) {
    const keys = new Set<string>();
    let tableCell = source ? cell(source.blockId, source.row, source.column) : null;
    for (const id of ids) {
      const entry = evidence.get(id);
      if (!entry) continue;
      const paragraph = paragraphs.get(entry.blockId);
      const block = blocks.get(entry.blockId);
      if (!paragraph || !block || paragraph.text !== block.text) continue;
      if (entry.cell) tableCell ??= cell(entry.blockId, entry.cell.row, entry.cell.column);
      if (
        entry.span &&
        entry.span.start < entry.span.end &&
        entry.span.end <= Array.from(paragraph.text).length
      ) {
        for (const sentence of model.sentences)
          if (
            sentence.paragraphId === entry.blockId &&
            sentence.start < entry.span.end &&
            sentence.end > entry.span.start
          )
            keys.add(sentence.key);
      }
    }
    return { sentenceKeys: [...keys], tableCell };
  }
  function decision(item: string, field: string) {
    const whole = decisions.find((d) => d.item_id === item && d.field === null);
    const specific = decisions.find((d) => d.item_id === item && d.field === field);
    return {
      rejected: whole?.decision === 'reject' || specific?.decision === 'reject',
      accepted: [whole, specific].some((d) => d?.decision === 'accept' || d?.decision === 'edit'),
      edit: specific?.decision === 'edit' ? specific.new_value : undefined,
    };
  }
  function add(
    kind: Kind,
    value: string | null,
    item: string,
    field: string,
    ids: string[],
    source: { blockId: string; row: number; column: number } | null = null,
    extras?: Partial<ExperimentFact>,
  ) {
    const review = decision(item, field);
    if (value === null && review.edit === undefined) return null;
    if (review.rejected) {
      dropped.rejected++;
      return null;
    }
    const actual = review.edit === undefined ? value : review.edit;
    if (actual === null || actual === '') return null;
    const location = anchor(ids, source);
    if (!location.sentenceKeys.length && !location.tableCell) {
      dropped.noAnchor++;
      return null;
    }
    const key = JSON.stringify([kind, actual]);
    const existing = index.get(key);
    if (existing) {
      existing.sentenceKeys = [...new Set([...existing.sentenceKeys, ...location.sentenceKeys])];
      existing.tableCell ??= location.tableCell;
      if (review.accepted) existing.status = 'accepted';
      return existing.id;
    }
    const numeric =
      kind === 'result' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(actual.trim())
        ? Number(actual)
        : null;
    const fact = {
      id: `fact-${facts.length + 1}`,
      kind,
      value: actual,
      number: Number.isFinite(numeric) ? numeric : null,
      unit: null,
      uncertainty: null,
      condition: null,
      metric: null,
      dataset: null,
      system: null,
      ...extras,
      ...location,
      status: review.accepted ? ('accepted' as const) : ('candidate' as const),
    };
    const parsed = ExperimentFactsSchema.shape.facts.element.parse(fact);
    facts.push(parsed);
    index.set(key, parsed);
    return parsed.id;
  }
  const datasets = new Map<string, string | null>();
  const baselines = new Map<string, string | null>();
  const methods = new Map<string, string | null>();
  for (const exp of run.profile.experiments) {
    const data = exp.protocol.data;
    const comparison = exp.protocol.comparison;
    datasets.set(exp.id, add('dataset', data.value, exp.id, 'protocol.data', data.evidence_ids));
    baselines.set(
      exp.id,
      add('baseline', comparison.value, exp.id, 'protocol.comparison', comparison.evidence_ids),
    );
    methods.set(
      exp.id,
      add(
        'method',
        exp.name,
        exp.id,
        'name',
        Object.values(exp.protocol).flatMap((f) => f.evidence_ids),
      ),
    );
  }
  const metrics = new Map(
    run.profile.metrics.map((metric) => [
      metric.id,
      add('metric', metric.reported_name, metric.id, 'reported_name', metric.evidence_ids),
    ]),
  );
  for (const result of run.profile.results) {
    if (decision(result.id, 'value').rejected) {
      dropped.rejected++;
      continue;
    }
    const system = result.system_or_baseline
      ? add(
          'baseline',
          result.system_or_baseline,
          result.id,
          'system_or_baseline',
          result.evidence_ids,
          result.source_table_cell,
        )
      : null;
    const exp = result.experiment_id;
    add('result', result.value, result.id, 'value', result.evidence_ids, result.source_table_cell, {
      unit: decision(result.id, 'unit').edit ?? result.unit,
      uncertainty: decision(result.id, 'uncertainty').edit ?? result.uncertainty,
      condition: decision(result.id, 'condition').edit ?? result.condition,
      metric: result.metric_usage_id ? (metrics.get(result.metric_usage_id) ?? null) : null,
      dataset: exp ? (datasets.get(exp) ?? null) : null,
      system: system ?? (exp ? (baselines.get(exp) ?? methods.get(exp) ?? null) : null),
    });
  }
  return {
    facts: ExperimentFactsSchema.parse({
      format: 'paperlab-experiment-facts',
      schemaVersion: 1,
      paperId,
      modelEtag,
      generatedAt: now.toISOString(),
      run: {
        id: run.id,
        promptVersion: run.profile.prompt_version,
        model: run.profile.model_id,
        at: run.createdAt,
      },
      facts,
    }),
    dropped,
  };
}
