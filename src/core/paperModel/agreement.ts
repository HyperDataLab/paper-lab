function check(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) throw new Error(`Length mismatch: ${a.length} vs ${b.length}`);
  if (!a.length) throw new Error('No labels to compare');
}

export function accuracy(gold: readonly string[], predicted: readonly string[]): number {
  check(gold, predicted);
  return gold.filter((label, i) => label === predicted[i]).length / gold.length;
}

/** Per-label F1 averaged over the labels in gold; a gold label never predicted scores 0. */
export function macroF1(gold: readonly string[], predicted: readonly string[]): number {
  check(gold, predicted);
  const labels = [...new Set(gold)];
  const scores = labels.map((label) => {
    let tp = 0,
      fp = 0,
      fn = 0;
    gold.forEach((g, i) => {
      const p = predicted[i];
      if (g === label && p === label) tp++;
      else if (p === label) fp++;
      else if (g === label) fn++;
    });
    return (2 * tp) / (2 * tp + fp + fn);
  });
  return scores.reduce((sum, value) => sum + value, 0) / labels.length;
}

/** Cohen's κ. When chance agreement is 1 (both raters use one label throughout) κ is undefined; 1 is returned. */
export function cohenKappa(a: readonly string[], b: readonly string[]): number {
  check(a, b);
  const n = a.length;
  const observed = accuracy(a, b);
  const count = (labels: readonly string[]) => {
    const map = new Map<string, number>();
    for (const label of labels) map.set(label, (map.get(label) ?? 0) + 1);
    return map;
  };
  const ca = count(a),
    cb = count(b);
  let expected = 0;
  for (const [label, x] of ca) expected += (x / n) * ((cb.get(label) ?? 0) / n);
  if (expected === 1) return 1;
  return (observed - expected) / (1 - expected);
}
