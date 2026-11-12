export type LabelSampleItem = {
  memberId: string;
  section: string;
  sentenceKey: string;
  label: string;
};

/** Draw across member/section strata in rounds, with a reproducible random order within each stratum. */
export function sampleLabels<T extends LabelSampleItem>(
  items: readonly T[],
  size: number,
  seed: string,
): T[] {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const groups = new Map<string, T[]>();
  const ordered = [...items].sort((a, b) =>
    JSON.stringify([a.memberId, a.section, a.sentenceKey, a.label]).localeCompare(
      JSON.stringify([b.memberId, b.section, b.sentenceKey, b.label]),
    ),
  );
  for (const item of ordered) {
    const key = JSON.stringify([item.memberId, item.section]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const strata = [...groups.values()];
  const shuffle = <U>(values: U[]) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const first = values[i];
      const second = values[j];
      if (first !== undefined && second !== undefined) {
        values[i] = second;
        values[j] = first;
      }
    }
  };
  shuffle(strata);
  strata.forEach(shuffle);
  const result: T[] = [];
  const limit = Math.max(0, Math.floor(size));
  while (result.length < limit && strata.some((group) => group.length > 0)) {
    for (const group of strata) {
      const item = group.pop();
      if (item) result.push(item);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/** Unsure decisions are excluded from the denominator. */
export function labelPrecision(verdicts: readonly ('correct' | 'incorrect' | 'unsure')[]) {
  const correct = verdicts.filter((verdict) => verdict === 'correct').length;
  const total = verdicts.filter((verdict) => verdict !== 'unsure').length;
  if (!total) return { correct, total, precision: null, lower: null, upper: null };
  const precision = correct / total;
  const z = 1.959963984540054;
  const denominator = 1 + (z * z) / total;
  const centre = (precision + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((precision * (1 - precision)) / total + (z * z) / (4 * total * total))) / denominator;
  return {
    correct,
    total,
    precision,
    lower: Math.max(0, centre - margin),
    upper: Math.min(1, centre + margin),
  };
}
