export type Work = {
  id: string;
  doi: string | null;
  title: string | null;
  publication_year: number;
  type: string;
  is_retracted: boolean;
  primary_location?: { source?: { id?: string } | null } | null;
  biblio?: { volume?: string | null; issue?: string | null } | null;
  authorships?: { author?: { id?: string }; institutions?: { country_code?: string | null }[] }[];
  /** OpenAlex citation count at harvest time; ranks the `admired` scope (see admired.ts). */
  cited_by_count?: number | null;
  primary_topic?: { subfield?: { id?: string | null } | null } | null;
};
export type Bucket = { from: number; to: number; target?: number };
export type SamplingOptions = {
  size: number;
  buckets: Bucket[];
  minPerBucket: number;
  capPerIssue: number | null;
  heldOutShare: number;
  seed: string;
};

/** `sort` is set for the `admired` scope only, which harvests one year at a time, most cited first. */
export function harvestQuery(protocol: {
  sourceId: string;
  years: number[];
  sort?: 'cited_by_count:desc';
}): string {
  const years = [...protocol.years].sort((a, b) => a - b);
  if (!years.length) throw new Error('Years are required');
  const params = new URLSearchParams({
    filter: `primary_location.source.id:${protocol.sourceId},type:article,from_publication_date:${years[0]}-01-01,to_publication_date:${years.at(-1)}-12-31,open_access.oa_status:gold|diamond|hybrid|bronze`,
    select:
      'id,doi,title,publication_year,primary_location,authorships,biblio,open_access,is_retracted,type,cited_by_count,primary_topic',
  });
  if (protocol.sort) params.set('sort', protocol.sort);
  return `https://api.openalex.org/works?${params}`;
}

export function excludeRecord(work: Work): string | null {
  if (work.is_retracted) return 'retracted';
  if (!work.doi?.trim()) return 'missing_doi';
  if (work.type !== 'article') return 'type';
  if (/\b(editorial|erratum|errata|corrigendum|corrigenda|correction|retraction)\b/iu.test(work.title ?? ''))
    return 'title';
  return null;
}

function random(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawSample(records: Work[], options: SamplingOptions) {
  const exclusions: Record<string, number> = {};
  const seen = new Set<string>();
  const eligible = records.filter((w) => {
    const reason = excludeRecord(w) ?? (seen.has(w.id) ? 'duplicate' : null);
    seen.add(w.id);
    if (reason) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    return !reason;
  });
  const rng = random(options.seed);
  const shuffled = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a && b) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  const selected: Work[] = [];
  const issues = new Map<string, number>();
  const venueCounts = new Map<string, number>();
  const bucketReports = options.buckets.map((bucket) => {
    const pool = shuffled.filter((w) => w.publication_year >= bucket.from && w.publication_year <= bucket.to);
    const desired =
      bucket.target ??
      Math.floor(options.size / options.buckets.length) +
        (options.buckets.indexOf(bucket) < options.size % options.buckets.length ? 1 : 0);
    const venueTotals = new Map<string, number>();
    for (const w of pool) {
      const v = w.primary_location?.source?.id ?? '';
      venueTotals.set(v, (venueTotals.get(v) ?? 0) + 1);
    }
    let count = 0;
    while (count < desired && pool.length) {
      pool.sort((a, b) => {
        const score = (w: Work) => {
          const v = w.primary_location?.source?.id ?? '';
          return (venueCounts.get(`${bucket.from}:${v}`) ?? 0) / (venueTotals.get(v) ?? 1);
        };
        return score(a) - score(b);
      });
      const w = pool.shift();
      if (!w) break;
      const venue = w.primary_location?.source?.id ?? '';
      const issue = w.biblio?.issue
        ? `${venue}:${w.publication_year}:${w.biblio.volume ?? ''}:${w.biblio.issue}`
        : null;
      if (issue && options.capPerIssue !== null && (issues.get(issue) ?? 0) >= options.capPerIssue) {
        exclusions.issue_cap = (exclusions.issue_cap ?? 0) + 1;
        continue;
      }
      if (issue) issues.set(issue, (issues.get(issue) ?? 0) + 1);
      venueCounts.set(`${bucket.from}:${venue}`, (venueCounts.get(`${bucket.from}:${venue}`) ?? 0) + 1);
      selected.push(w);
      count++;
    }
    return {
      from: bucket.from,
      to: bucket.to,
      count,
      target: desired,
      shortfall: Math.max(0, Math.max(desired, options.minPerBucket) - count),
    };
  });
  // Shuffle the selected papers independently before assigning the held-out roles.
  const held = [...selected];
  for (let i = held.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = held[i];
    const b = held[j];
    if (a && b) {
      held[i] = b;
      held[j] = a;
    }
  }
  const heldIds = new Set(held.slice(0, Math.round(selected.length * options.heldOutShare)).map((w) => w.id));
  return {
    sample: selected.map((work) => ({
      work,
      role: heldIds.has(work.id) ? ('held_out' as const) : ('build' as const),
    })),
    report: { buckets: bucketReports, exclusions },
  };
}
