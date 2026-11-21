import { snapshot } from '../researchDesign/bank/testSupport';
import { toBankDoc } from '../researchDesign/bank/readSnapshot';
import { snapshotFileSchema } from '../researchDesign/bank/snapshot';
import type { Draft } from '../researchDesign/draft/schema';
import type { StageContent } from './contracts';
import { at, outputs } from './fixtures';

export const bank = toBankDoc(snapshotFileSchema.parse(snapshot), '2026.01.1', 'synthetic', at);
export function designFixture(hypothesisIds = outputs.S8.hypotheses.map((h) => h.id)) {
  return {
    design: { id: 'rd.test-experiment', rationale: 'Compare matched synthetic review tasks.' },
    datasets: [
      { name: 'Suite', source: 'Synthetic', split: 'test', bankRef: 'bm.test-suite', license: 'CC0' },
    ],
    baselines: [
      {
        name: 'Control',
        why: 'Same review procedure without calibration.',
        ...(outputs.S4.candidates[0] && { citeKey: outputs.S4.candidates[0].citationKey }),
      },
    ],
    methods: [{ name: 'Calibration', hypothesisIds }],
    ablations: hypothesisIds.map((hypothesisId) => ({
      name: 'Without examples',
      removes: 'Examples',
      hypothesisId,
    })),
    metrics: [
      {
        name: 'Agreement',
        direction: 'higher_better',
        hypothesisIds,
        bankRef: 'met.test-score',
        protocolRef: 'mp.test-procedure',
      },
    ],
    conditions: [
      { name: 'Control', baseline: true, params: {} },
      { name: 'Calibration', baseline: false, params: {} },
    ],
    threats: [{ bankRef: 'vt.test-confound', mitigation: 'Separate review sessions.' }],
    compute: { estimate: 'One local evaluation process', budget: 'Within approved lab resources' },
    analysis: hypothesisIds.map((hypothesisId) => ({
      hypothesisId,
      test: 'ttest_welch',
      alpha: 0.05,
      correction: 'holm',
      metric: 'Agreement',
      conditions: ['Calibration', 'Control'],
    })),
  } satisfies Omit<StageContent['S10'], 'bank'>;
}

export function completeDraft(draft: Draft): Draft {
  return {
    ...draft,
    metrics: draft.metrics.map((metric) => ({
      ...metric,
      unit: 'agreement points',
      protocol: 'Measure the agreement score per run.',
      aggregation: 'last',
    })),
    runMatrix: {
      ...draft.runMatrix,
      mlflowExperiment: 'Synthetic',
      seeds: [0, 1, 2],
      sampleSizeJustification: 'Synthetic fixture to verify the workflow.',
    },
  };
}

export const csv = [
  'runId,condition,dataset,seed,Agreement',
  'control-a,Control,Suite,0,1',
  'control-b,Control,Suite,1,2',
  'control-c,Control,Suite,2,3',
  'test-a,Calibration,Suite,0,6',
  'test-b,Calibration,Suite,1,8',
  'test-c,Calibration,Suite,2,10',
].join('\n');
