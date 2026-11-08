import { describe, expect, it } from 'vitest';
import { CalibrationLabelsSchema } from '../schemas';
import {
  calibrationStatus,
  deduplicateLabels,
  collectDecisions,
  interRaterAgreement,
  kappa,
  labelTemplate,
  matchLabels,
  precisionByType,
  scoreCalibration,
} from './index';
import type { CalibrationStore } from './index';

const target = { kind: 'issue', type: 'FUZZY_VERB', textHash: 'hash', quote: 'word' } as const;
const empty: CalibrationStore = { analyses: [], papers: [], checks: [], reviews: [] };
describe('P7 calibration', () => {
  it('P7 deduplicates rater targets using timestamps and reports conflicting targets once', () => {
    const a = { rater: 'a', target, label: 'correct' as const };
    const b = { ...a, label: 'incorrect' as const };
    const result = deduplicateLabels([
      { label: b, at: '2026-03' },
      { label: a, at: '2026-01' },
      { label: a, at: '2026-02' },
    ]);
    expect(result).toEqual({ labels: [b], conflicts: 1 });
    expect(precisionByType([a, a, b])[0]).toMatchObject({ n: 1, correct: 0, incorrect: 1 });
  });
  it('round trips the label template and validates labels', () => {
    expect(CalibrationLabelsSchema.parse(JSON.parse(JSON.stringify(labelTemplate())))).toEqual(
      labelTemplate(),
    );
    expect(
      CalibrationLabelsSchema.safeParse({ ...labelTemplate(), labels: [{ rater: 'a', target, label: 4 }] })
        .success,
    ).toBe(false);
  });
  it('reports unmatched targets and collects only human decisions', () => {
    const store = {
      ...empty,
      analyses: [
        {
          text: { sourceHash: 'hash', sourceText: 'word' },
          issues: [
            { type: 'FUZZY_VERB', status: 'confirmed_by_human', spans: [{ start: 0, end: 4 }] },
            { type: 'FUZZY_VERB', status: 'candidate', spans: [{ start: 0, end: 4 }] },
          ],
          scores: null,
        },
      ],
    } as unknown as CalibrationStore;
    const labels = collectDecisions(store);
    expect(labels).toEqual([{ rater: 'local', target, label: 'correct' }]);
    expect(
      matchLabels(
        [...labels, { rater: 'a', target: { ...target, quote: 'absent' }, label: 'incorrect' }],
        store,
      ),
    ).toEqual({
      matched: labels,
      unmatched: [{ rater: 'a', target: { ...target, quote: 'absent' }, label: 'incorrect' }],
    });
  });
  it('calculates Wilson intervals and product thresholds', () => {
    const [emptyStats] = precisionByType([], [{ kind: 'issue', type: 'x' }]);
    expect(emptyStats).toMatchObject({ n: 0, precision: null, wilsonLow: null });
    const [stats] = precisionByType(
      Array.from({ length: 10 }, (_, i) => ({ rater: `r${i}`, target, label: 'correct' as const })),
    );
    expect(stats?.wilsonLow).toBeCloseTo(0.72247, 4);
    expect(stats?.wilsonHigh).toBeCloseTo(1);
    expect(calibrationStatus({ n: 29, wilsonLow: 1 })).toBe('uncalibrated');
    expect(calibrationStatus({ n: 30, wilsonLow: 0.65 })).toBe('reliable');
    expect(calibrationStatus({ n: 30, wilsonLow: 0.64 })).toBe('unreliable');
  });
  it('calculates binary and quadratic agreement, including degenerate tables', () => {
    expect(
      kappa([
        [0, 0],
        [1, 1],
      ]).kappa,
    ).toBe(1);
    expect(
      kappa([
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]).kappa,
    ).toBe(0);
    expect(
      kappa([
        [1, 1],
        [1, 1],
      ]).kappa,
    ).toBeNull();
    expect(
      kappa(
        [
          [0, 1],
          [4, 3],
        ],
        true,
      ).kappa,
    ).toBeCloseTo(0.8);
    expect(
      interRaterAgreement(
        [
          { rater: 'a', target, label: 'correct' },
          { rater: 'b', target, label: 'incorrect' },
        ],
        'a',
        'b',
      ),
    ).toMatchObject([{ kind: 'issue', n: 1, kappa: 0 }]);
  });
  it('measures signed score inflation and absolute error', () => {
    const analyses = [
      { text: { sourceHash: 'hash' }, scores: { dimensions: [{ id: 'flow', rubric: 3 }] } },
    ] as unknown as CalibrationStore['analyses'];
    expect(
      scoreCalibration(
        [{ rater: 'a', target: { kind: 'score', dimension: 'flow', textHash: 'hash' }, label: 1 }],
        analyses,
      ),
    ).toEqual([{ dimension: 'flow', n: 1, mae: 2, bias: 2, weightedKappa: 0 }]);
  });
  it('P7 gathers check and lens decisions from anchored paper text', () => {
    const store = {
      ...empty,
      papers: [{ id: 'p', paragraphs: [{ id: 's', text: '😀 quoted text', textHash: 'h' }] }],
      checks: [
        {
          paperId: 'p',
          report: {
            checks: [
              {
                id: 'refs',
                findings: [
                  {
                    id: 'f',
                    locations: [
                      { paragraphId: 's', start: 2, end: 8 },
                      { paragraphId: 'missing', start: 0, end: 1 },
                    ],
                  },
                ],
              },
            ],
          },
          decisions: [{ findingId: 'f', status: 'dismissed_by_human', note: 'no' }],
        },
      ],
      reviews: [
        {
          paperId: 'p',
          runs: [
            {
              merged: [
                { id: 'r', lenses: ['clarity_editor'], anchor: { paragraphId: 's', start: 2, end: 8 } },
                {
                  id: 'missing',
                  lenses: ['clarity_editor'],
                  anchor: { paragraphId: 'missing', start: 0, end: 1 },
                },
              ],
            },
          ],
          decisions: [{ pointId: 'r', status: 'confirmed_by_human' }],
        },
      ],
    } as unknown as CalibrationStore;
    expect(collectDecisions(store)).toEqual([
      {
        rater: 'local',
        target: { kind: 'check', type: 'refs', textHash: 'h', quote: 'quoted' },
        label: 'incorrect',
        note: 'no',
      },
      {
        rater: 'local',
        target: { kind: 'point', type: 'clarity_editor', textHash: 'h', quote: 'quoted' },
        label: 'correct',
      },
    ]);
  });
  it('P7 excludes ambiguous repeated rater judgments and inconsistent model scores', () => {
    const a = { rater: 'a', target, label: 'correct' as const };
    expect(interRaterAgreement([a, a, { ...a, rater: 'b' }], 'a', 'b')).toMatchObject([
      { n: 0, kappa: null },
    ]);
    expect(interRaterAgreement([a], 'a', 'a')).toEqual([]);
    expect(kappa([])).toEqual({ n: 0, kappa: null });
    const label = {
      rater: 'a',
      target: { kind: 'score' as const, dimension: 'flow', textHash: 'h' },
      label: 2,
    };
    const analyses = [2, 3].map((rubric) => ({
      text: { sourceHash: 'h' },
      scores: { dimensions: [{ id: 'flow', rubric }] },
    })) as unknown as CalibrationStore['analyses'];
    expect(scoreCalibration([label], analyses)).toEqual([]);
    expect(precisionByType([{ ...a, label: 'incorrect' }])[0]).toMatchObject({ incorrect: 1, precision: 0 });
  });
});
