import { describe, expect, it } from 'vitest';
import { canonicalDigest, exportIdOf } from './index';

describe('C1a corpus helpers', () => {
  it('C1a canonical digest sorts keys recursively and preserves role', async () => {
    const first = { member: { role: 'build', stratum: { year: 2020, issue: '1' } } };
    const reordered = { member: { stratum: { issue: '1', year: 2020 }, role: 'build' } };
    expect(await canonicalDigest(first)).toBe(await canonicalDigest(reordered));
    expect(await canonicalDigest(first)).not.toBe(
      await canonicalDigest({ member: { ...first.member, role: 'held_out' } }),
    );
  });
  it('C1a export IDs satisfy the bank pattern', () => {
    expect(exportIdOf('00000000-0000-4000-8000-000000000001')).toMatch(/^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/u);
  });
});
