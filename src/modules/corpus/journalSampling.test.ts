import { expect, it } from 'vitest';
import { createEswaPair, ESWA_SEED } from './journalSampling';

it('C4a creates the ESWA pair with the decided sources', () => {
  const pair = createEswaPair('target', 'control', '2026-01-01T00:00:00.000Z');
  expect(pair.map((c) => c.kind)).toEqual(['journal', 'control']);
  const bodies = pair.map((c) => c.protocol[0]?.body);
  expect(bodies.map((b) => (b && 'venues' in b ? b.venues.map((v) => v.openalexSourceId) : []))).toEqual([
    ['S13144211'],
    ['S10169007', 'S900972176', 'S45693802'],
  ]);
  expect(bodies.every((b) => b && 'seed' in b && b.seed === ESWA_SEED)).toBe(true);
  // The control follows its target's scope, so it records none.
  expect(bodies.map((b) => b && 'venues' in b && b.sampling)).toEqual([{ scope: 'signature' }, undefined]);
});

it('P4 creates an admired ESWA pair with N recorded on the protocol', () => {
  const sampling = { scope: 'admired', n: 100, rankedBy: 'cited_by_count within publication year' } as const;
  const [target] = createEswaPair('target', 'control', '2026-01-01T00:00:00.000Z', sampling);
  const body = target?.protocol[0]?.body;
  expect(body && 'sampling' in body && body.sampling).toEqual(sampling);
  expect(body && 'samplingRule' in body && body.samplingRule).toContain('top 100');
});
