import { BOOTSTRAP_RESAMPLES, quantile, seededRandom } from './stats';

export type HoldoutPaper = {
  values: Readonly<Record<string, number | null | undefined>>;
  authorIds: readonly string[];
};
export type HoldoutResult = {
  auc: number | null;
  ci95Low: number | null;
  ci95High: number | null;
  nTarget: number;
  nControl: number;
  droppedForAuthorOverlap: number;
  passed: boolean;
  rule: string;
};
export const HOLDOUT_RULE = 'AUC CI 95% lower bound > 0.6';

/** Train only on build papers; bootstrap whole held-out papers within each corpus. */
export function testHoldout(
  featureIds: readonly string[],
  buildTarget: readonly HoldoutPaper[],
  buildControl: readonly HoldoutPaper[],
  heldTarget: readonly HoldoutPaper[],
  heldControl: readonly HoldoutPaper[],
  seed: number,
): HoldoutResult {
  const authors = (rows: readonly HoldoutPaper[]) => new Set(rows.flatMap((p) => [...p.authorIds]));
  const targetAuthors = authors(buildTarget),
    controlAuthors = authors(buildControl);
  const keep = (rows: readonly HoldoutPaper[], forbidden: Set<string>) =>
    rows.filter((p) => !p.authorIds.some((id) => forbidden.has(id)));
  const target = keep(heldTarget, controlAuthors),
    control = keep(heldControl, targetAuthors);
  const droppedForAuthorOverlap = heldTarget.length + heldControl.length - target.length - control.length;
  const empty = {
    auc: null,
    ci95Low: null,
    ci95High: null,
    nTarget: target.length,
    nControl: control.length,
    droppedForAuthorOverlap,
    passed: false,
    rule: HOLDOUT_RULE,
  };
  if (!featureIds.length || !buildTarget.length || !buildControl.length || !target.length || !control.length)
    return empty;
  const build = [...buildTarget, ...buildControl];
  const scales = featureIds.map((id) => {
    const values = build
      .map((p) => p.values[id])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length || 1));
    return { mean, sd: sd || 1 };
  });
  const vector = (p: HoldoutPaper) =>
    featureIds.map((id, i) => {
      const scale = scales[i] ?? { mean: 0, sd: 1 },
        value = p.values[id];
      return (typeof value === 'number' && Number.isFinite(value) ? value - scale.mean : 0) / scale.sd;
    });
  const vectors = build.map(vector),
    weights = featureIds.map(() => 0);
  let intercept = 0;
  for (let iteration = 0; iteration < 1000; iteration++) {
    const gradient = weights.map(() => 0);
    let bias = 0;
    vectors.forEach((x, i) => {
      const score = intercept + x.reduce((sum, v, j) => sum + v * (weights[j] ?? 0), 0);
      const error =
        1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score)))) - (i < buildTarget.length ? 1 : 0);
      bias += error;
      x.forEach((v, j) => {
        gradient[j] = (gradient[j] ?? 0) + error * v;
      });
    });
    intercept -= (0.1 * bias) / build.length;
    weights.forEach((w, j) => {
      weights[j] = w - 0.1 * ((gradient[j] ?? 0) / build.length + 0.01 * w);
    });
  }
  const score = (p: HoldoutPaper) => vector(p).reduce((sum, v, i) => sum + v * (weights[i] ?? 0), intercept);
  const a = target.map(score),
    b = control.map(score);
  const auc = (x: readonly number[], y: readonly number[]) =>
    x.reduce((sum, v) => sum + y.reduce((s, w) => s + (v > w ? 1 : v === w ? 0.5 : 0), 0), 0) /
    (x.length * y.length);
  const random = seededRandom(seed);
  const draw = (v: readonly number[]) => v.map(() => v[Math.floor(random() * v.length)] ?? 0);
  const samples = Array.from({ length: BOOTSTRAP_RESAMPLES }, () => auc(draw(a), draw(b))).sort(
    (x, y) => x - y,
  );
  const ci95Low = quantile(samples, 0.025),
    ci95High = quantile(samples, 0.975);
  return { ...empty, auc: auc(a, b), ci95Low, ci95High, passed: ci95Low !== null && ci95Low > 0.6 };
}
