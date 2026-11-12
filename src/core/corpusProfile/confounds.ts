import type { CorpusMember } from '../schemas/corpus';

type Member = CorpusMember & { topics?: readonly string[] };
export type ConfoundCheck = { name: string; target: string; control: string; distance: number | null };

/** Shares are over observed assignments; missing metadata is reported explicitly. */
export function confoundChecks(target: readonly Member[], control: readonly Member[]): ConfoundCheck[] {
  const distribution = (members: readonly Member[], values: (m: Member) => readonly string[]) => {
    const counts = new Map<string, number>();
    for (const m of members)
      for (const value of new Set(values(m))) counts.set(value, (counts.get(value) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return new Map([...counts].map(([key, count]) => [key, count / total]));
  };
  const check = (name: string, values: (m: Member) => readonly string[], limit: number): ConfoundCheck => {
    const a = distribution(target, values),
      b = distribution(control, values);
    const format = (map: Map<string, number>) =>
      map.size
        ? [...map]
            .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
            .slice(0, limit)
            .map(([key, share]) => `${key}: ${(share * 100).toFixed(1)}%`)
            .join(', ')
        : 'Not available';
    const keys = new Set([...a.keys(), ...b.keys()]);
    return {
      name,
      target: format(a),
      control: format(b),
      distance:
        a.size && b.size
          ? [...keys].reduce((sum, key) => sum + Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0)), 0) / 2
          : null,
    };
  };
  return [
    check(
      'Year (two-year buckets)',
      (m) =>
        m.stratum.year === undefined
          ? []
          : [`${Math.floor(m.stratum.year / 2) * 2}-${Math.floor(m.stratum.year / 2) * 2 + 1}`],
      Infinity,
    ),
    check('OpenAlex topics', (m) => m.topics ?? [], 10),
    check('Author institution countries', (m) => m.countries, 10),
  ];
}
