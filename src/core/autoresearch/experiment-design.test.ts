import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bank, designFixture } from './ar3-fixtures';
import { bankDesignInputs, pinDesignBank, s10Schema } from './experiment-design';
import { outputs } from './fixtures';
import { passStage } from './validation';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it('S10 validates approved hypotheses, screened citeKeys and each Writing Bank collection', async () => {
  const value = { ...designFixture(), bank: await pinDesignBank(bankDesignInputs(bank)) };
  expect(s10Schema.safeParse(value).success).toBe(true);
  expect(passStage('S10', value, outputs)).toBeNull();
  expect(s10Schema.safeParse({ ...value, compute: { estimate: 25, budget: 'qualitative' } }).success).toBe(
    false,
  );
  expect(
    s10Schema.safeParse({ ...value, analysis: value.analysis.map((row) => ({ ...row, alpha: 1 })) }).success,
  ).toBe(false);
  const dataset = value.datasets[0];
  const metric = value.metrics[0];
  if (!dataset || !metric) throw new Error('Missing design fixture');
  const invalid = [
    { design: { ...value.design, id: 'rd.absent' } },
    { datasets: [{ ...dataset, bankRef: 'met.test-score' }] },
    { metrics: [{ ...metric, bankRef: 'mp.test-procedure' }] },
    { metrics: [{ ...metric, protocolRef: 'mp.absent' }] },
    { threats: [{ bankRef: 'vt.absent', mitigation: 'Control the order.' }] },
    { baselines: [{ name: 'Control', why: 'Comparison', citeKey: 'fabricated' }] },
    { bank: null },
    { methods: [] },
    { metrics: [{ ...metric, hypothesisIds: ['h-agree'] }] },
    { analysis: value.analysis.slice(1) },
  ];
  for (const patch of invalid)
    expect(passStage('S10', { ...value, ...patch }, outputs)).toBe('INVALID_DESIGN');
  expect(passStage('S10', value, { ...outputs, S5: { ...outputs.S5, decisions: [] } })).toBe(
    'INVALID_DESIGN',
  );
});
