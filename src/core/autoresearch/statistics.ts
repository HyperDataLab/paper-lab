export function summarize(values: readonly number[]) {
  let n = 0;
  let mean = 0;
  let squares = 0;
  for (const value of values) {
    const delta = value - mean;
    mean += delta / ++n;
    squares += delta * (value - mean);
  }
  const variance = n > 1 ? Math.max(0, squares / (n - 1)) : null;
  return {
    n,
    mean: n && Number.isFinite(mean) ? mean : null,
    sd: variance !== null && Number.isFinite(variance) ? Math.sqrt(variance) : null,
  };
}

const lanczos = [
  676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
  -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];
function logGamma(value: number): number {
  const z = value - 1;
  const x = lanczos.reduce((sum, coefficient, i) => sum + coefficient / (z + i + 1), 0.9999999999998099);
  const t = z + 7.5;
  return Math.log(2 * Math.PI) / 2 + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Modified Lentz continued fraction for the regularized incomplete beta function.
function betaFraction(a: number, b: number, x: number) {
  const nonzero = (v: number) => (Math.abs(v) < 1e-300 ? 1e-300 : v);
  let c = 1;
  let d = 1 / nonzero(1 - ((a + b) * x) / (a + 1));
  let f = d;
  const step = (coefficient: number) => {
    c = nonzero(1 + coefficient / c);
    d = 1 / nonzero(1 + coefficient * d);
    return c * d;
  };
  for (let m = 1; m <= 200; m++) {
    const am = a + 2 * m;
    f *= step((m * (b - m) * x) / ((am - 1) * am));
    const delta = step((-(a + m) * (a + b + m) * x) / (am * (am + 1)));
    f *= delta;
    if (Math.abs(delta - 1) < 3e-14) return f;
  }
  return NaN;
}

function beta(x: number, a: number, b: number) {
  if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaFraction(a, b, x)) / a
    : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

type TestValue = { statistic: number; p: number; effect: number };
function tValue(effect: number, se: number, df: number): TestValue | null {
  const statistic = effect / se;
  const p = beta(df / (df + statistic ** 2), df / 2, 0.5);
  return se > 0 && Number.isFinite(statistic) && Number.isFinite(p) && p > 0
    ? { statistic, p: Math.min(1, p), effect }
    : null;
}

export function welchT(left: readonly number[], right: readonly number[], threshold = 0): TestValue | null {
  const a = summarize(left);
  const b = summarize(right);
  if (a.mean === null || b.mean === null || a.sd === null || b.sd === null) return null;
  const v1 = a.sd ** 2 / a.n;
  const v2 = b.sd ** 2 / b.n;
  const se = Math.sqrt(v1 + v2);
  if (!se || !Number.isFinite(se)) return null;
  const ratio = v1 / (v1 + v2);
  const df = 1 / (ratio ** 2 / (a.n - 1) + (1 - ratio) ** 2 / (b.n - 1));
  return tValue(a.mean - b.mean - threshold, se, df);
}

export function pairedT(left: readonly number[], right: readonly number[], threshold = 0): TestValue | null {
  if (left.length !== right.length) return null;
  const paired = summarize(left.map((x, i) => x - (right[i] ?? NaN)));
  if (paired.mean === null || paired.sd === null) return null;
  return tValue(paired.mean - threshold, paired.sd / Math.sqrt(paired.n), paired.n - 1);
}

function exactRankTail(n: number, m: number, u: number) {
  const size = Math.min(n, m);
  const limit = size * (n + m) - (size * (size - 1)) / 2;
  const counts = Array.from({ length: size + 1 }, () => new Float64Array(limit + 1));
  counts[0]?.set([1]);
  for (let rank = 1; rank <= n + m; rank++) {
    for (let k = Math.min(rank, size); k > 0; k--) {
      const current = counts[k];
      const previous = counts[k - 1];
      if (!current || !previous) continue;
      for (let sum = rank; sum <= limit; sum++)
        current[sum] = (current[sum] ?? 0) + (previous[sum - rank] ?? 0);
    }
  }
  const tail = Math.min(u, n * m - u) + (size * (size + 1)) / 2;
  const bins = counts[size];
  if (!bins) return NaN;
  return Math.min(
    1,
    (2 * bins.slice(0, tail + 1).reduce((a, b) => a + b, 0)) / bins.reduce((a, b) => a + b, 0),
  );
}

// Complementary error function, evaluated directly so small normal tails avoid cancellation.
function erfc(x: number) {
  if (x === 0) return 1;
  const t = 1 / (1 + 0.5 * x);
  const coefficients = [
    1.00002368, 0.37409196, 0.09678418, -0.18628806, 0.27886807, -1.13520398, 1.48851587, -0.82215223,
    0.17087277,
  ];
  const polynomial = coefficients.reduceRight((sum, coefficient) => t * (sum + coefficient), 0);
  return Math.min(1, t * Math.exp(-x * x - 1.26551223 + polynomial));
}

export function mannWhitney(
  left: readonly number[],
  right: readonly number[],
): (TestValue & { exact: boolean }) | null {
  const n = left.length;
  const m = right.length;
  if (!n || !m) return null;
  const ranked = [
    ...left.map((value) => ({ value, left: true })),
    ...right.map((value) => ({ value, left: false })),
  ].sort((a, b) => a.value - b.value);
  let rankSum = 0;
  let ties = 0;
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end]?.value === ranked[start]?.value) end++;
    const count = end - start;
    ties += count ** 3 - count;
    for (let index = start; index < end; index++) if (ranked[index]?.left) rankSum += (start + 1 + end) / 2;
    start = end;
  }
  const statistic = rankSum - (n * (n + 1)) / 2;
  const effect = statistic / (n * m) - 0.5;
  const exact = ties === 0 && Math.min(n, m) <= 8 && n + m <= 50;
  const variance = ((n * m) / 12) * (n + m + 1 - ties / ((n + m) * (n + m - 1)));
  const distance = Math.max(0, Math.abs(statistic - (n * m) / 2) - 0.5);
  const p = exact
    ? exactRankTail(n, m, statistic)
    : variance === 0
      ? 1
      : erfc(distance / Math.sqrt(2 * variance));
  return p > 0 && Number.isFinite(p) ? { statistic, p, effect, exact } : null;
}

export type Correction = 'none' | 'bonferroni' | 'holm' | 'fdr_bh';
export function correctP(values: readonly (number | null)[], method: Correction) {
  const sorted = values.map((p, index) => ({ p, index })).sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
  const n = sorted.length;
  const corrected = [...values];
  const order = method === 'fdr_bh' ? sorted.reverse() : sorted;
  let monotone = method === 'holm' ? 0 : 1;
  order.forEach(({ p, index }, i) => {
    if (p === null) return;
    if (method === 'holm') monotone = Math.max(monotone, p * (n - i));
    if (method === 'fdr_bh') monotone = Math.min(monotone, (p * n) / (n - i));
    corrected[index] = Math.min(1, method === 'none' ? p : method === 'bonferroni' ? p * n : monotone);
  });
  return corrected;
}
