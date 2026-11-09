import { expect, it } from 'vitest';
import type { MeasurementDecision } from '../schemas/measurement';
import { evidenceRate, latestDecisions, reviewedProfile, reviewQueueSize } from './review';
import { fixtureProfile, fixtureRun } from './testFixture';

const RUN = fixtureRun().id;
const decision = (over: Partial<MeasurementDecision>): MeasurementDecision => ({
  run_id: RUN,
  item_id: 'mu-1',
  field: null,
  decision: 'accept',
  reviewer: 'local',
  timestamp: '2026-01-03T00:00:00.000Z',
  previous_value: null,
  new_value: null,
  note: null,
  ...over,
});

it('AC-07 applies an edit and leaves the AI original untouched', () => {
  const original = fixtureProfile();
  const snapshot = structuredClone(original);
  const edited = reviewedProfile(
    original,
    [decision({ decision: 'edit', field: 'method.procedure', new_value: 'Đếm số dự đoán đúng' })],
    RUN,
  );
  expect(edited.metrics[0]?.method.procedure).toMatchObject({
    value: 'Đếm số dự đoán đúng',
    status: 'HUMAN_EDITED',
    needs_review: false,
  });
  expect(original).toEqual(snapshot);
});

it('AC-07 removes unsupported evidence and recomputes metric evidence after an edit', () => {
  const edited = reviewedProfile(
    fixtureProfile(),
    [decision({ decision: 'edit', field: 'unit', new_value: 'percent' })],
    RUN,
  );
  expect(edited.metrics[0]?.unit).toMatchObject({
    value: 'percent',
    status: 'HUMAN_EDITED',
    evidence_ids: [],
  });
  expect(edited.metrics[0]?.evidence_ids).toEqual(edited.metrics[0]?.definition.evidence_ids);
});

it('AC-07 keeps only evidence supporting a reported edit', () => {
  const original = fixtureProfile();
  const metric = original.metrics[0]!;
  metric.definition.evidence_ids.push(...metric.unit.evidence_ids);
  const edited = reviewedProfile(
    original,
    [decision({ decision: 'edit', field: 'definition', new_value: 'correct predictions' })],
    RUN,
  );
  expect(edited.metrics[0]?.definition).toMatchObject({
    status: 'REPORTED',
    evidence_ids: [metric.definition.evidence_ids[0]],
    needs_review: false,
  });
});

it('AC-07 edits protocol fields and result values', () => {
  const edited = reviewedProfile(
    fixtureProfile(),
    [
      decision({ item_id: 'exp-1', decision: 'edit', field: 'protocol.seeds', new_value: '7' }),
      decision({ item_id: 'r-1', decision: 'edit', field: 'value', new_value: '0.5' }),
      decision({ item_id: 'r-1', decision: 'edit', field: 'nope.nope', new_value: 'x' }),
    ],
    RUN,
  );
  expect(edited.experiments[0]?.protocol.seeds.value).toBe('7');
  expect(edited.results[0]?.value).toBe('0.5');
  expect(edited.results[0]).toMatchObject({
    status: 'HUMAN_EDITED',
    evidence_ids: [],
    source_table_cell: null,
    needs_review: false,
  });
});

it('FR-15 removes a rejected item and every link to it', () => {
  const profile = reviewedProfile(fixtureProfile(), [decision({ item_id: 'mu-1', decision: 'reject' })], RUN);
  expect(profile.metrics).toEqual([]);
  expect(profile.results[0]?.metric_usage_id).toBeNull();
  expect(profile.claims[0]?.linked_metric_ids).toEqual([]);
  const experiment = reviewedProfile(
    fixtureProfile(),
    [decision({ item_id: 'exp-1', decision: 'reject' })],
    RUN,
  );
  expect(experiment.results[0]?.experiment_id).toBeNull();
  expect(experiment.metrics[0]?.experiment_ids).toEqual([]);
  const result = reviewedProfile(fixtureProfile(), [decision({ item_id: 'r-1', decision: 'reject' })], RUN);
  expect(result.claims[0]?.linked_result_ids).toEqual([]);
  const kept = reviewedProfile(fixtureProfile(), [decision({ decision: 'reject' })], RUN, {
    keepRejected: true,
  });
  expect(kept.metrics).toHaveLength(1);
});

it('FR-15 lets the latest decision win and reopen clear it', () => {
  const list = [
    decision({ decision: 'reject' }),
    decision({ decision: 'reopen', timestamp: '2026-01-04T00:00:00.000Z' }),
    decision({ item_id: 'x', run_id: '00000000-0000-4000-8000-0000000000bb' }),
  ];
  expect(latestDecisions(list, RUN)).toEqual([]);
  expect(reviewedProfile(fixtureProfile(), list, RUN).metrics).toHaveLength(1);
});

it('FR-15 clears review flags on accept, by item and by field', () => {
  const flagged = fixtureProfile();
  flagged.results[0]!.needs_review = true;
  flagged.metrics[0]!.unit.needs_review = true;
  flagged.metrics[0]!.method.procedure.needs_review = true;
  expect(reviewQueueSize(flagged)).toBe(3);
  const byField = reviewedProfile(flagged, [decision({ field: 'unit' })], RUN);
  expect(byField.metrics[0]?.unit.needs_review).toBe(false);
  expect(byField.metrics[0]?.method.procedure.needs_review).toBe(true);
  const byItem = reviewedProfile(flagged, [decision({}), decision({ item_id: 'r-1' })], RUN);
  expect(byItem.metrics[0]?.method.procedure.needs_review).toBe(false);
  expect(byItem.results[0]?.needs_review).toBe(false);
  expect(reviewQueueSize(byItem)).toBe(0);
  expect(
    reviewedProfile(flagged, [decision({ item_id: 'unknown' })], RUN).metrics[0]?.unit.needs_review,
  ).toBe(true);
});

it('reports the share of filled fields with evidence', () => {
  expect(evidenceRate(fixtureProfile())).toEqual({ withEvidence: 3, total: 3, rate: 1 });
  const empty = { ...fixtureProfile(), metrics: [], experiments: [], results: [] };
  expect(evidenceRate(empty)).toEqual({ withEvidence: 0, total: 0, rate: null });
});
