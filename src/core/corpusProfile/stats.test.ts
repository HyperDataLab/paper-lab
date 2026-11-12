import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  bootstrapCi,
  bootstrapDifference,
  chiSquare1Tail,
  cohensD,
  keyness,
  mannWhitney,
  proportionDifference,
  quantile,
  summarize,
} from './stats';

describe('C5a paper-level statistics', () => {
  it('C5a summarises a corpus with sample SD and type-7 quartiles', () => {
    // Mean 2.5; squared deviations sum to 5, so sd = sqrt(5/3); q1 at h = 0.75, q3 at h = 2.25.
    const s = summarize([4, 1, 3, 2]);
    expect(s).toMatchObject({ n: 4, mean: 2.5, median: 2.5, q1: 1.75, q3: 3.25 });
    expect(s.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(summarize([])).toEqual({ n: 0, mean: null, sd: null, median: null, q1: null, q3: null });
    expect(summarize([7]).sd).toBeNull();
    expect(quantile([0, 10], 0.975)).toBeCloseTo(9.75);
  });
  it('C5a computes a standardised mean difference from pooled variance', () => {
    // Both sample variances are one; the means differ by two.
    expect(cohensD([1, 2, 3], [3, 4, 5])).toBe(-2);
    expect(cohensD([1, 1], [2, 2])).toBeNull();
  });
  it('C5a computes a difference in proportions for binary features', () => {
    expect(proportionDifference([1, 1, 0, 0], [1, 0, 0, 0])).toBe(0.25);
  });
  it('C5a bootstraps papers reproducibly', () => {
    expect(bootstrapDifference([3, 3], [1, 1], 42)).toEqual([2, 2]);
    expect(bootstrapDifference([], [1], 42)).toBeNull();
    expect(bootstrapDifference([1, 2, 3], [0, 1], 42)).toEqual(bootstrapDifference([1, 2, 3], [0, 1], 42));
    // Two draws from {0, 1}: the resampled mean is 0, 0.5 or 1 with probabilities 1/4, 1/2, 1/4.
    expect(bootstrapDifference([0, 1], [0, 0], 7)).toEqual([0, 1]);
  });
  it('C5a bootstraps the effect size itself and drops undefined resamples', () => {
    const ci = bootstrapCi([1, 2, 3, 4, 5], [3, 4, 5, 6, 7], 1, cohensD);
    expect(ci).not.toBeNull();
    const [low, high] = ci ?? [0, 0];
    expect(low).toBeLessThan(cohensD([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]) ?? 0);
    expect(high).toBeGreaterThan(cohensD([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]) ?? 0);
    // Every resample of constant corpora has a zero pooled SD, so no CI.
    expect(bootstrapCi([1, 1], [2, 2], 1, cohensD)).toBeNull();
  });
  it('C5a tests ranks with Mann–Whitney (hand-computed normal approximation)', () => {
    // U = 0, mean 4.5, variance 9/12 · 7 = 5.25, z = (4.5 − 0.5)/√5.25 = 1.745743, p = 2 · 0.0404278.
    expect(mannWhitney([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.080856, 5);
    expect(mannWhitney([4, 5, 6], [1, 2, 3])).toBeCloseTo(0.080856, 5);
    expect(mannWhitney([1, 1], [1, 1])).toBe(1);
    expect(mannWhitney([], [1])).toBeNull();
  });
  it('C5a adjusts all valid p values and retains missing entries', () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03, null])).toEqual([0.03, 0.04, 0.04, null]);
  });
  it('C5a computes G squared, its p value and smoothed log ratio from the contingency table', () => {
    // Observed: [10, 0, 0, 10]; every expected cell is 5.
    const result = keyness(10, 10, 0, 10);
    expect(result.g2).toBeCloseTo(40 * Math.log(2));
    expect(result.logRatio).toBeCloseTo(Math.log2(21));
    expect(result.pValue).toBeLessThan(1e-5);
    expect(keyness(5, 10, 5, 10)).toMatchObject({ g2: 0, pValue: 1, logRatio: 0 });
    // 3.841459 is the 95th percentile of chi-square with one degree of freedom.
    expect(chiSquare1Tail(3.841459)).toBeCloseTo(0.05, 6);
    expect(() => keyness(11, 10, 0, 10)).toThrow();
  });
});
