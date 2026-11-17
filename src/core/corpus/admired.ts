import type { Corpus, CorpusSampling } from '../schemas/corpus';
import { excludeRecord, type Work } from './sampling';

/** The protocol's scope; a protocol from before P4 has none and drew the C4a (`signature`) sample. */
export function samplingOf(body: Corpus['protocol'][number]['body'] | undefined): CorpusSampling {
  return (body && 'sampling' in body ? body.sampling : undefined) ?? { scope: 'signature' };
}
/** The human-readable `samplingRule` of a journal protocol for its scope. */
export function samplingRuleText(sampling: CorpusSampling) {
  return sampling.scope === 'admired'
    ? `top ${sampling.n} by cited_by_count within publication year; equal per year; no hold-out`
    : '150; minimum 20 per two-year bucket; 20% held out';
}

/**
 * The `admired` scope (writing-bank doc 39 §2): the N most cited papers of a journal, ranked within publication
 * year because raw `cited_by_count` favours old papers.
 *
 * - Bucket: one publication year. Each year gets `perYear` papers when given, otherwise `floor(n / years)`; the
 *   remainder `n % years` goes one each to the earliest years, as `drawSample` does for its buckets.
 * - A year with fewer eligible papers than its quota is reported as a shortfall and is not refilled from other
 *   years, so the buckets stay equal.
 * - Ranking: `cited_by_count` descending; a missing count ranks after every known count (including 0); ties break
 *   by DOI (lower case, without the doi.org prefix), then by OpenAlex id. The result is deterministic.
 * - Eligibility is the same as C4a: `excludeRecord` and one record per OpenAlex id.
 * - There is no held-out split, so an admired corpus is always `exploratory` (doc 39: below 150 + 150).
 */
export type AdmiredYearReport = {
  year: number;
  target: number;
  count: number;
  shortfall: number;
  /** Selected papers whose citation count was missing. */
  missingCitedBy: number;
};
export type AdmiredResult = {
  sample: { work: Work; rank: number }[];
  report: { years: AdmiredYearReport[]; exclusions: Record<string, number> };
};

export function admiredQuotas(input: { n: number; years: number[]; perYear?: number }): Map<number, number> {
  const years = [...new Set(input.years)].sort((a, b) => a - b);
  const quotas = new Map<number, number>();
  years.forEach((year, i) =>
    quotas.set(
      year,
      input.perYear ?? Math.floor(input.n / years.length) + (i < input.n % Math.max(years.length, 1) ? 1 : 0),
    ),
  );
  return quotas;
}

/** `https://openalex.org/S13144211` and `S13144211` name the same source. */
const sourceKey = (id: string | null | undefined) =>
  (id ?? '')
    .trim()
    .replace(/^https?:\/\/openalex\.org\//iu, '')
    .toUpperCase();
const doiKey = (doi: string | null) =>
  (doi ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//u, '');
export function compareAdmired(a: Work, b: Work) {
  const ca = typeof a.cited_by_count === 'number' ? a.cited_by_count : -1;
  const cb = typeof b.cited_by_count === 'number' ? b.cited_by_count : -1;
  return cb - ca || doiKey(a.doi).localeCompare(doiKey(b.doi)) || a.id.localeCompare(b.id);
}

function eligible(records: Work[], exclusions: Record<string, number>) {
  const seen = new Set<string>();
  return records.filter((w) => {
    const reason = excludeRecord(w) ?? (seen.has(w.id) ? 'duplicate' : null);
    seen.add(w.id);
    if (reason) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    return !reason;
  });
}

/** Within each year, ranks every group (one per venue for the control) on its own and takes its quota. */
function rankWithinYears(
  pool: Work[],
  quotas: Map<number, number>,
  groups: (quota: number) => { quota: number; match: (w: Work) => boolean }[],
) {
  const sample: AdmiredResult['sample'] = [];
  const years = [...quotas].map(([year, target]) => {
    let count = 0;
    let missingCitedBy = 0;
    for (const group of groups(target)) {
      const ranked = pool.filter((w) => w.publication_year === year && group.match(w)).sort(compareAdmired);
      ranked.slice(0, group.quota).forEach((work, i) => {
        sample.push({ work, rank: i + 1 });
        count++;
        if (typeof work.cited_by_count !== 'number') missingCitedBy++;
      });
    }
    return { year, target, count, shortfall: Math.max(0, target - count), missingCitedBy };
  });
  return { sample, years };
}

/** Target journal: the top `n` papers ranked within each publication year, equal numbers per year. */
export function selectAdmired(input: {
  members: Work[];
  n: number;
  years: number[];
  perYear?: number;
}): AdmiredResult {
  const exclusions: Record<string, number> = {};
  const pool = eligible(input.members, exclusions);
  const { sample, years } = rankWithinYears(pool, admiredQuotas(input), (quota) => [
    { quota, match: () => true },
  ]);
  return { sample, report: { years, exclusions } };
}

/**
 * Control journals: per year, as many papers as the target's admired sample has in that year, ranked the same way.
 * The year's quota is split evenly across the control venues (remainder to the venues in protocol order), and each
 * venue is ranked on its own, so the largest control journal cannot take the whole year. A venue's shortfall is
 * not refilled from another venue.
 */
export function selectAdmiredControl(input: {
  members: Work[];
  targetPerYear: Map<number, number>;
  venues: string[];
}): AdmiredResult {
  const exclusions: Record<string, number> = {};
  const pool = eligible(input.members, exclusions);
  const venues = input.venues.length ? input.venues.map(sourceKey) : [''];
  const { sample, years } = rankWithinYears(pool, input.targetPerYear, (quota) =>
    venues.map((venue, i) => ({
      quota: Math.floor(quota / venues.length) + (i < quota % venues.length ? 1 : 0),
      match: (w: Work) => !input.venues.length || sourceKey(w.primary_location?.source?.id) === venue,
    })),
  );
  return { sample, report: { years, exclusions } };
}
