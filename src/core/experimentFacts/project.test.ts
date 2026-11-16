/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturePaper, fixtureRun } from '../measurement/testFixture';
import { examplePaperModel } from '../paperModel/contract';
import { ExperimentFactsSchema, type MeasurementDecision } from '../schemas';
import {
  experimentFactsJsonSchema,
  exampleExperimentFacts,
  EXPERIMENT_FACTS_EXAMPLE_FILE,
  EXPERIMENT_FACTS_SCHEMA_FILE,
  EXPERIMENT_FACTS_SCHEMA_PUBLIC_FILE,
} from './contract';
import { projectExperimentFacts } from './project';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
const at = '2026-01-02T00:00:00.000Z';
function input() {
  const run = fixtureRun();
  return {
    paperId: fixturePaper.id,
    paper: fixturePaper,
    model: examplePaperModel(),
    modelEtag: 'a'.repeat(64),
    now: new Date(at),
    record: {
      schemaVersion: 1 as const,
      paperId: fixturePaper.id,
      updatedAt: at,
      runs: [run],
      decisions: [] as MeasurementDecision[],
      pending: null,
    },
  };
}
function decide(
  item_id: string,
  field: string | null,
  decision: MeasurementDecision['decision'],
  new_value: string | null = null,
): MeasurementDecision {
  return {
    run_id: fixtureRun().id,
    item_id,
    field,
    decision,
    new_value,
    previous_value: null,
    reviewer: 'local',
    timestamp: at,
    note: null,
  };
}
describe('experiment facts contract', () => {
  it('generates the published schemas and valid synthetic example without drift', () => {
    expect(read(EXPERIMENT_FACTS_SCHEMA_FILE)).toEqual(experimentFactsJsonSchema());
    expect(read(EXPERIMENT_FACTS_SCHEMA_PUBLIC_FILE)).toEqual(experimentFactsJsonSchema());
    expect(read(EXPERIMENT_FACTS_EXAMPLE_FILE)).toEqual(exampleExperimentFacts());
    expect(ExperimentFactsSchema.parse(read(EXPERIMENT_FACTS_EXAMPLE_FILE)).facts.length).toBeGreaterThan(0);
    const doc = exampleExperimentFacts();
    const fact = doc.facts[0];
    expect(fact).toBeDefined();
    expect(ExperimentFactsSchema.safeParse({ ...doc, paperId: `sha256-${'b'.repeat(64)}` }).success).toBe(
      true,
    );
    expect(ExperimentFactsSchema.safeParse({ ...doc, paperId: 'sha256:x' }).success).toBe(false);
    for (const kind of ['task', 'design', 'sample'])
      expect(ExperimentFactsSchema.safeParse({ ...doc, facts: [{ ...fact, kind }] }).success).toBe(true);
    expect(
      ExperimentFactsSchema.safeParse({ ...doc, facts: [{ ...fact, sentenceKeys: [], tableCell: null }] })
        .success,
    ).toBe(false);
  });
  it('links facts, table headers and human decisions, and drops unanchored items', () => {
    const args = input();
    const run = args.record.runs[0];
    if (!run) throw new Error('fixture missing');
    const profile = run.profile;
    const exp = profile.experiments[0];
    const result = profile.results[0];
    const metric = profile.metrics[0];
    if (!exp || !result || !metric) throw new Error('fixture missing');
    exp.protocol.data = { ...exp.protocol.data, value: 'Toy dataset', evidence_ids: metric.evidence_ids };
    exp.protocol.comparison = {
      ...exp.protocol.comparison,
      value: 'Unanchored comparison',
      evidence_ids: [],
    };
    args.record.decisions.push(decide(metric.id, null, 'accept'), decide(result.id, 'value', 'edit', '0.5'));
    const output = projectExperimentFacts(args);
    const fact = output.facts.facts.find((f) => f.kind === 'result');
    expect(fact).toMatchObject({
      value: '0.5',
      number: 0.5,
      status: 'accepted',
      tableCell: { rowHeader: 'Baseline', columnHeader: 'Accuracy (%)' },
    });
    expect(output.facts.facts.find((f) => f.id === fact?.metric)).toMatchObject({
      kind: 'metric',
      status: 'accepted',
    });
    expect(output.facts.facts.find((f) => f.id === fact?.dataset)?.kind).toBe('dataset');
    expect(output.facts.facts.find((f) => f.id === fact?.system)?.kind).toBe('baseline');
    expect(output.dropped.noAnchor).toBeGreaterThan(0);
    args.record.decisions.push(decide(result.id, null, 'reject'));
    expect(projectExperimentFacts(args).facts.facts.some((f) => f.kind === 'result')).toBe(false);
    expect(projectExperimentFacts(args).dropped.rejected).toBeGreaterThan(0);
  });
  it('anchors text by code points and leaves nonnumeric results null', () => {
    const args = input();
    const run = args.record.runs[0];
    if (!run) throw new Error('fixture missing');
    const profile = run.profile;
    const result = profile.results[0];
    if (!result) throw new Error('fixture missing');
    const block = args.paper.paragraphs.find((p) => p.id === 'r1');
    const modelBlock = args.model.document.blocks.find((p) => p.id === 'r1');
    const sentence = args.model.sentences.find((s) => s.paragraphId === 'r1');
    if (!block || !modelBlock || !sentence) throw new Error('fixture missing');
    const paper = structuredClone(args.paper);
    const model = structuredClone(args.model);
    const p = paper.paragraphs.find((v) => v.id === 'r1');
    const b = model.document.blocks.find((v) => v.id === 'r1');
    if (!p || !b) throw new Error('fixture missing');
    p.text = `😀 ${p.text}`;
    b.text = p.text;
    const s = model.sentences.find((v) => v.paragraphId === 'r1');
    if (!s) throw new Error('fixture missing');
    s.start += 2;
    s.end += 2;
    profile.evidence.push({
      id: 'unicode',
      blockId: 'r1',
      page: 3,
      sectionId: 'res',
      kind: 'text',
      span: { start: 2, end: 5 },
      cell: null,
      source_excerpt: 'The',
      needs_review: false,
    });
    result.evidence_ids = ['unicode'];
    result.source_table_cell = null;
    result.value = 'not reported';
    const fact = projectExperimentFacts({ ...args, paper, model }).facts.facts.find(
      (f) => f.kind === 'result',
    );
    expect(fact).toMatchObject({ number: null, sentenceKeys: [sentence.key], tableCell: null });
  });
});
