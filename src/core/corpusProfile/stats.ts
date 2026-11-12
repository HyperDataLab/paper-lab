export const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export const BOOTSTRAP_RESAMPLES = 2000;

/** Seeded linear congruential generator (Numerical Recipes constants), uniform on [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Linear interpolation between order statistics (Hyndman–Fan type 7, the R and NumPy default). */
export function quantile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p,
    low = Math.floor(h);
  const a = sorted[low] ?? 0,
    b = sorted[Math.min(low + 1, sorted.length - 1)] ?? a;
  return a + (h - low) * (b - a);
}

export type SummaryStats = {
  n: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
};

/** Sample standard deviation (n − 1); null below two values. */
export function summarize(values: readonly number[]): SummaryStats {
  const sorted = [...values].sort((a, b) => a - b);
  const m = mean(sorted);
  const sd =
    m === null || sorted.length < 2
      ? null
      : Math.sqrt(sorted.reduce((sum, x) => sum + (x - m) ** 2, 0) / (sorted.length - 1));
  return {
    n: sorted.length,
    mean: m,
    sd,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

export const meanDifference = (target: readonly number[], control: readonly number[]): number | null => {
  const a = mean(target),
    b = mean(control);
  return a === null || b === null ? null : a - b;
};

/** For 0/1 values the mean is the proportion, so this is p(target) − p(control). */
export const proportionDifference = meanDifference;

export function cohensD(target: readonly number[], control: readonly number[]): number | null {
  const a = mean(target),
    b = mean(control);
  if (a === null || b === null || target.length < 2 || control.length < 2) return null;
  const squared = (values: readonly number[], m: number) => values.reduce((sum, x) => sum + (x - m) ** 2, 0);
  const pooled = Math.sqrt((squared(target, a) + squared(control, b)) / (target.length + control.length - 2));
  return pooled ? (a - b) / pooled : null;
}

type Statistic = (target: readonly number[], control: readonly number[]) => number | null;

/**
 * Percentile bootstrap CI (2.5th and 97.5th of 2,000 resamples) for a two-sample statistic. Whole papers are
 * resampled with replacement, independently within each corpus; resamples where the statistic is undefined
 * (for example a zero pooled SD) are dropped.
 */
export function bootstrapCi(
  target: readonly number[],
  control: readonly number[],
  seed: number,
  statistic: Statistic = meanDifference,
  resamples = BOOTSTRAP_RESAMPLES,
): [number, number] | null {
  if (!target.length || !control.length) return null;
  const random = seededRandom(seed);
  const draw = (values: readonly number[]) =>
    values.map(() => values[Math.floor(random() * values.length)] ?? 0);
  const samples: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const value = statistic(draw(target), draw(control));
    if (value !== null && Number.isFinite(value)) samples.push(value);
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return [quantile(samples, 0.025) ?? 0, quantile(samples, 0.975) ?? 0];
}

/** Bootstrap CI for the difference in means (for 0/1 values, in proportions). */
export const bootstrapDifference = (target: readonly number[], control: readonly number[], seed: number) =>
  bootstrapCi(target, control, seed, meanDifference);

/** Upper tail of the standard normal, Abramowitz–Stegun 26.2.17 (absolute error below 7.5e-8). */
export function normalUpperTail(z: number): number {
  if (z < 0) return 1 - normalUpperTail(-z);
  const t = 1 / (1 + 0.2316419 * z);
  return (
    (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  );
}

/** Upper tail of chi-square with one degree of freedom: P(X > x) = 2 · P(Z > √x). */
export const chiSquare1Tail = (x: number): number =>
  x <= 0 ? 1 : Math.min(1, 2 * normalUpperTail(Math.sqrt(x)));

/** Two-sided Mann–Whitney U test: normal approximation with tie and continuity correction. */
export function mannWhitney(target: readonly number[], control: readonly number[]): number | null {
  if (!target.length || !control.length) return null;
  const values = [
    ...target.map((value) => ({ value, target: true })),
    ...control.map((value) => ({ value, target: false })),
  ].sort((a, b) => a.value - b.value);
  let rankSum = 0,
    ties = 0;
  for (let i = 0; i < values.length;) {
    let j = i + 1;
    while (j < values.length && values[j]?.value === values[i]?.value) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (values[k]?.target) rankSum += rank;
    ties += (j - i) ** 3 - (j - i);
    i = j;
  }
  const n = values.length,
    product = target.length * control.length;
  const variance = (product / 12) * (n + 1 - ties / (n * (n - 1)));
  if (!variance) return 1;
  const u = rankSum - (target.length * (target.length + 1)) / 2;
  const z = Math.max(0, Math.abs(u - product / 2) - 0.5) / Math.sqrt(variance);
  return Math.min(1, 2 * normalUpperTail(z));
}

/** Benjamini–Hochberg adjusted p values (q); null entries are not part of the family and stay null. */
export function benjaminiHochberg(pValues: readonly (number | null)[]): (number | null)[] {
  const sorted = pValues.flatMap((p, index) => (p === null ? [] : [{ p, index }])).sort((a, b) => a.p - b.p);
  const result: (number | null)[] = pValues.map(() => null);
  let next = 1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const item = sorted[i];
    if (!item) continue;
    next = Math.min(next, (item.p * sorted.length) / (i + 1));
    result[item.index] = next;
  }
  return result;
}

/**
 * Keyness from a two-by-two table: `a` of `targetTotal` against `b` of `controlTotal`. G² is the
 * log-likelihood ratio (Dunning 1993) with its chi-square (1 df) p value; Log Ratio (Hardie 2014) is the
 * binary log of the ratio of relative frequencies, with 0.5 added to each count so that zero counts stay finite.
 */
export function keyness(a: number, targetTotal: number, b: number, controlTotal: number) {
  if (a < 0 || b < 0 || a > targetTotal || b > controlTotal || !targetTotal || !controlTotal)
    throw new Error('Invalid phrase counts');
  const cells = [a, targetTotal - a, b, controlTotal - b];
  const total = targetTotal + controlTotal,
    hits = a + b;
  const expected = [
    (targetTotal * hits) / total,
    (targetTotal * (total - hits)) / total,
    (controlTotal * hits) / total,
    (controlTotal * (total - hits)) / total,
  ];
  const g2 = Math.max(
    0,
    2 * cells.reduce((sum, value, i) => sum + (value ? value * Math.log(value / (expected[i] ?? 1)) : 0), 0),
  );
  return {
    g2,
    pValue: chiSquare1Tail(g2),
    logRatio: Math.log2((a + 0.5) / (targetTotal + 0.5) / ((b + 0.5) / (controlTotal + 0.5))),
  };
}
