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
  expect(bodies[0]).not.toHaveProperty('bank');
  // The control follows its target's scope, so it records none.
  expect(bodies.map((b) => b && 'venues' in b && b.sampling)).toEqual([{ scope: 'signature' }, undefined]);
});

it('uses the registry venue and profile for the ESWA target without a snapshot release', () => {
  const pair = createEswaPair('target', 'control', '2026-01-01T00:00:00.000Z', undefined, {
    id: 'jrn.synthetic-eswa',
    profile: 'jr.eswa',
    name: 'Synthetic ESWA',
    kind: 'journal',
    issns: ['1234-5679'],
    openalexSourceId: 'S12345',
  });
  expect(pair[0]?.protocol[0]?.body).toMatchObject({
    venues: [{ name: 'Synthetic ESWA', issn: ['1234-5679'], openalexSourceId: 'S12345' }],
    bank: { journalId: 'jrn.synthetic-eswa', journalProfile: 'jr.eswa' },
  });
  expect(pair[0]?.protocol[0]?.body).not.toHaveProperty('bank.release');
  expect(pair[1]?.protocol[0]?.body).not.toHaveProperty('bank');
});

it('P4 creates an admired ESWA pair with N recorded on the protocol', () => {
  const sampling = { scope: 'admired', n: 100, rankedBy: 'cited_by_count within publication year' } as const;
  const [target] = createEswaPair('target', 'control', '2026-01-01T00:00:00.000Z', sampling);
  const body = target?.protocol[0]?.body;
  expect(body && 'sampling' in body && body.sampling).toEqual(sampling);
  expect(body && 'samplingRule' in body && body.samplingRule).toContain('top 100');
});
