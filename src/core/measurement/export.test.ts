import { expect, it } from 'vitest';
import { MeasurementProfileSchema, type MeasurementDecision } from '../schemas/measurement';
import { measurementJson, measurementMarkdown, metricsCsv, protocolCsv } from './export';
import {
  goldVerdict,
  MeasurementGoldSchema,
  scoreAgainstGold,
  sumScores,
  type MeasurementGold,
} from './gold';
import { fixtureProfile, fixtureRun } from './testFixture';

const run = fixtureRun();
const edit: MeasurementDecision = {
  run_id: run.id,
  item_id: 'mu-1',
  field: 'unit',
  decision: 'edit',
  reviewer: 'local',
  timestamp: '2026-01-03T00:00:00.000Z',
  previous_value: '%',
  new_value: 'percent',
  note: null,
};

it('AC-07 FR-16 exports valid JSON with the edit, the AI original and the action', () => {
  const output = measurementJson(run, [edit]);
  expect(MeasurementProfileSchema.safeParse(output.profile).success).toBe(true);
  expect(output.profile.metrics[0]?.unit.value).toBe('percent');
  expect(output.ai_original.metrics[0]?.unit.value).toBe('%');
  expect(output.review_actions).toEqual([edit]);
});

it('FR-16 leaves another run out of the review actions', () => {
  expect(
    measurementJson(run, [{ ...edit, run_id: fixtureRun('00000000-0000-4000-8000-0000000000bb').id }])
      .review_actions,
  ).toEqual([]);
});

it('FR-14 FR-16 separates author statements, interpretation and concerns in Markdown', () => {
  const text = measurementMarkdown(fixtureProfile());
  expect(text).toContain('Tác giả nêu');
  expect(text).toContain('## AI lưu ý');
  expect(text).toContain('Baseline: 0.123 ± 0.004 %');
  expect(text).toContain('p.3 t1 r1c1');
  expect(text).toContain('Không thấy trong phần đã phân tích');
  expect(text).toContain('không có điểm tổng');
  expect(text).toContain('Chỉ trong kịch bản đã đo.');
});

it('FR-16 flags unverified results and lists a survey taxonomy in Markdown', () => {
  const profile = fixtureProfile();
  profile.results[0] = {
    ...profile.results[0]!,
    status: 'INFERRED',
    needs_review: true,
    uncertainty: null,
    evidence_ids: [],
  };
  profile.taxonomy = [
    {
      id: 'tx-1',
      construct: 'Quality',
      metric: 'F1',
      how_measured: profile.metrics[0]!.unit,
      domain: profile.metrics[0]!.unit,
      evidence_ids: [],
    },
  ];
  const text = measurementMarkdown(profile);
  expect(text).toContain('chưa kiểm chứng được');
  expect(text).toContain('cần xem lại');
  expect(text).toContain('không có nguồn');
  expect(text).toContain('- Quality · F1');
});

it('FR-16 writes metric and protocol CSV', () => {
  const metrics = metricsCsv(fixtureProfile()).split('\r\n');
  expect(metrics[0]).toContain('reported_name');
  expect(metrics[1]).toContain('Accuracy');
  expect(metrics[1]).toContain('Main');
  const protocol = protocolCsv(fixtureProfile()).split('\r\n');
  expect(protocol).toHaveLength(10);
  expect(protocol[7]).toContain('seeds,,NOT_REPORTED,no,,met; res');
});

it('FR-16 neutralises spreadsheet formulas but keeps negative numbers and escapes quotes', () => {
  const profile = fixtureProfile();
  profile.metrics[0]!.reported_name = '=HYPERLINK("x")';
  profile.metrics[0]!.aliases = ['-1.5'];
  profile.metrics[0]!.definition.value = '-cmd';
  const row = metricsCsv(profile).split('\r\n')[1] ?? '';
  expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  expect(row).toContain(',-1.5,');
  expect(row).toContain(`'-cmd`);
});

const gold: MeasurementGold = MeasurementGoldSchema.parse({
  format: 'paragraph-lab-measurement-gold',
  version: 1,
  paper_sha256: 'sha256:abc',
  rater: 'a',
  metrics: [{ name: 'accuracy' }, { name: 'F1', aliases: ['F-score'] }],
  results: [
    { value: '0.123', unit: '%', blockId: 't1', reader_correct: true },
    { value: '9', unit: null, blockId: null, reader_correct: true },
    { value: '7', unit: null, blockId: 'x', reader_correct: false },
  ],
  reported_protocol_fields: [],
});

it('§12 scores a profile against a gold standard and separates parsing errors', () => {
  const score = scoreAgainstGold(fixtureProfile(), gold);
  expect(score.metricPrecision).toEqual({ hit: 1, n: 1 });
  expect(score.metricRecall).toEqual({ hit: 1, n: 2 });
  expect(score.numericExact).toEqual({ hit: 1, n: 2 });
  expect(score.evidenceLocation).toEqual({ hit: 1, n: 1 });
  expect(score.parsingErrors).toBe(1);
  expect(score.protocolPrecision).toEqual({ hit: 0, n: 0 });
});

it('§12 counts a reported protocol field the gold does not have as a false report', () => {
  const profile = fixtureProfile();
  profile.experiments[0]!.protocol.seeds = {
    value: '7',
    status: 'REPORTED',
    evidence_ids: ['ev-1'],
    needs_review: false,
  };
  profile.experiments[0]!.protocol.data = {
    value: 'd',
    status: 'REPORTED',
    evidence_ids: ['ev-1'],
    needs_review: false,
  };
  const score = scoreAgainstGold(profile, {
    ...gold,
    reported_protocol_fields: [{ experiment: 'main', field: 'seeds' }],
  });
  expect(score.protocolPrecision).toEqual({ hit: 1, n: 2 });
  expect(score.falseReported).toEqual({ hit: 1, n: 2 });
});

it('§12 sums papers and reports not measured until there is data', () => {
  const score = scoreAgainstGold(fixtureProfile(), gold);
  const total = sumScores([score, score]);
  expect(total.metricRecall).toEqual({ hit: 2, n: 4 });
  expect(total.parsingErrors).toBe(2);
  expect(goldVerdict('protocolPrecision', { hit: 0, n: 0 })).toBe('not_measured');
  expect(goldVerdict('metricPrecision', { hit: 9, n: 10 })).toBe('met');
  expect(goldVerdict('metricPrecision', { hit: 8, n: 10 })).toBe('not_met');
  expect(goldVerdict('falseReported', { hit: 0, n: 10 })).toBe('met');
  expect(goldVerdict('falseReported', { hit: 1, n: 10 })).toBe('not_met');
});
