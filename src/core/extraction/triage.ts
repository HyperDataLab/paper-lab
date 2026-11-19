import type { Candidate, ScreeningStatus, SearchPlan, TriageOutput } from '../schemas/deepResearch';
import { decideCandidate } from './deep';

/** Screening triage sends this many papers per call (15–20 keeps the reply short enough to follow). */
export const TRIAGE_BATCH = 18;
export const TRIAGE_ABSTRACT_CHARS = 1200;

export type Criterion = { id: string; kind: 'include' | 'exclude'; text: string };
export type Thresholds = { include: number; exclude: number };
export type TriageBucket = Exclude<ScreeningStatus, 'candidate'>;
export const DEFAULT_THRESHOLDS: Thresholds = { include: 0.7, exclude: 0.3 };
export const TRIAGE_BUCKETS: TriageBucket[] = ['included', 'excluded', 'uncertain'];

/** The plan's criteria with short ids the model copies back: I1… for inclusion, E1… for exclusion. */
export function criteriaOf(plan: Pick<SearchPlan, 'inclusion' | 'exclusion'>): Criterion[] {
  return [
    ...plan.inclusion.map((text, index) => ({ id: `I${index + 1}`, kind: 'include' as const, text })),
    ...plan.exclusion.map((text, index) => ({ id: `E${index + 1}`, kind: 'exclude' as const, text })),
  ];
}

/** Triaged means the suggestion carries a relevance score; older suggestions without one are graded again. */
export const isTriaged = (candidate: Candidate) => typeof candidate.suggestion?.relevance === 'number';
export const triagePending = (candidates: Candidate[]) =>
  candidates.filter((candidate) => candidate.status === 'candidate' && !isTriaged(candidate));

export function triageBatches<T>(items: T[], size = TRIAGE_BATCH): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

const clip = (value: string | null, chars: number) =>
  value && value.length > chars ? `${value.slice(0, chars)}…` : value;

/** What the model sees for one paper: title, year, venue, type, citations, keywords and a cut abstract. */
export function triageRow(label: string, candidate: Candidate) {
  return [
    `[${label}] ${JSON.stringify(candidate.title)}`,
    `year: ${candidate.year ?? 'unknown'}`,
    `venue: ${candidate.venue ?? 'unknown'}`,
    `type: ${candidate.workType ?? 'unknown'}`,
    `cited by: ${candidate.citedBy ?? 'unknown'}`,
    candidate.keywords?.length ? `keywords: ${candidate.keywords.join('; ')}` : 'keywords: none',
    `abstract: ${JSON.stringify(clip(candidate.abstract, TRIAGE_ABSTRACT_CHARS) ?? 'no abstract')}`,
  ].join(' | ');
}

/** Calls and a rough token count (about 4 characters a token, plus the instructions) before running. */
export function estimateTriage(candidates: Candidate[], size = TRIAGE_BATCH) {
  const pending = triagePending(candidates);
  const calls = Math.ceil(pending.length / size);
  const chars = pending.reduce((sum, item, index) => sum + triageRow(`P${index + 1}`, item).length, 0);
  // Instructions per call, and a reply of about 60 tokens per paper.
  const tokens = Math.round(chars / 4 + calls * 400 + pending.length * 60);
  return { papers: pending.length, calls, tokens };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const DECISION = { include: 'included', exclude: 'excluded', unsure: 'uncertain' } as const;

/**
 * One batch reply onto the candidates, matched by the labels the batch was sent with. Scores are clamped
 * to 0–1, unknown criterion ids are dropped, and papers missing from the reply, given no relevance, or
 * decided meanwhile by a person are left as they are.
 */
export function applyTriage(
  candidates: Candidate[],
  batch: { label: string; key: string }[],
  output: TriageOutput,
  criteria: Criterion[],
  meta: { model: string; promptVersion: string },
) {
  const ids = new Set(criteria.map((item) => item.id));
  const byKey = new Map<string, NonNullable<Candidate['suggestion']>>();
  for (const row of output.papers) {
    const key = batch.find(
      (item) =>
        item.label.toLowerCase() ===
        row.label
          .trim()
          .replace(/^\[|\]$/g, '')
          .toLowerCase(),
    )?.key;
    if (!key || row.relevance === null || !Number.isFinite(row.relevance)) continue;
    byKey.set(key, {
      decision: DECISION[row.decision_suggestion],
      reason: row.reason.trim(),
      relevance: clamp(row.relevance),
      quality: row.quality === null || !Number.isFinite(row.quality) ? null : clamp(row.quality),
      matched: [...new Set(row.matched_criteria.map((id) => id.trim().toUpperCase()))].filter((id) =>
        ids.has(id),
      ),
      model: meta.model,
      promptVersion: meta.promptVersion,
    });
  }
  return candidates.map((candidate) => {
    const suggestion = byKey.get(candidate.key);
    return suggestion && candidate.status === 'candidate' ? { ...candidate, suggestion } : candidate;
  });
}

export function normalThresholds(thresholds: Thresholds): Thresholds {
  const include = clamp(
    Number.isFinite(thresholds.include) ? thresholds.include : DEFAULT_THRESHOLDS.include,
  );
  const exclude = clamp(
    Number.isFinite(thresholds.exclude) ? thresholds.exclude : DEFAULT_THRESHOLDS.exclude,
  );
  return { include, exclude: Math.min(exclude, include) };
}

export const exclusionMatched = (candidate: Candidate) =>
  (candidate.suggestion?.matched ?? []).some((id) => id.startsWith('E'));

/**
 * The bucket the thresholds put a triaged paper in: Loại when an exclusion criterion matched or relevance is
 * under the exclude threshold, Chọn at or above the include threshold, otherwise Chưa chắc. Null when the
 * paper has no triage scores.
 */
export function bucketOf(
  candidate: Candidate,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): TriageBucket | null {
  const relevance = candidate.suggestion?.relevance;
  if (typeof relevance !== 'number') return null;
  const { include, exclude } = normalThresholds(thresholds);
  if (exclusionMatched(candidate) || relevance < exclude) return 'excluded';
  if (relevance >= include) return 'included';
  return 'uncertain';
}

/** Undecided, triaged papers in each bucket; the counts follow the thresholds live. */
export function triageBuckets(candidates: Candidate[], thresholds: Thresholds = DEFAULT_THRESHOLDS) {
  const buckets: Record<TriageBucket, Candidate[]> = { included: [], excluded: [], uncertain: [] };
  for (const candidate of candidates) {
    if (candidate.status !== 'candidate') continue;
    const bucket = bucketOf(candidate, thresholds);
    if (bucket) buckets[bucket].push(candidate);
  }
  return buckets;
}

/**
 * Papers for a person to look at first: the closest to a threshold, with a disagreement between the model's
 * own decision and the bucket counted as closeness. Deterministic, so the same list shows on every render.
 */
export function borderlineSample(
  candidates: Candidate[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  size = 5,
): string[] {
  const { include, exclude } = normalThresholds(thresholds);
  return candidates
    .flatMap((candidate) => {
      const bucket = candidate.status === 'candidate' ? bucketOf(candidate, thresholds) : null;
      const relevance = candidate.suggestion?.relevance;
      if (!bucket || typeof relevance !== 'number') return [];
      const distance = Math.min(Math.abs(relevance - include), Math.abs(relevance - exclude));
      const disagrees = candidate.suggestion?.decision !== bucket;
      return [{ key: candidate.key, score: distance - (disagrees ? 0.15 : 0) }];
    })
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, size)
    .map((item) => item.key);
}

/**
 * Applies the current buckets to the given papers as the person's decisions, marked `ai_accepted`. Only
 * papers still undecided whose bucket is `bucket` change, so a stale list cannot overwrite a decision.
 */
export function acceptTriage(
  candidates: Candidate[],
  keys: string[],
  bucket: TriageBucket,
  thresholds: Thresholds,
  at: string,
) {
  const accepted = acceptableKeys(candidates, keys, bucket, thresholds);
  let next = candidates;
  for (const key of accepted) next = decideCandidate(next, key, bucket, at, undefined, 'ai_accepted');
  return { candidates: next, applied: accepted.length };
}

/**
 * The keys a bulk apply may decide: each once, still undecided and still in `bucket` under the current
 * thresholds. Every decide path (Project candidates, corpus members) filters through this first.
 */
export function acceptableKeys(
  candidates: Candidate[],
  keys: string[],
  bucket: TriageBucket,
  thresholds: Thresholds,
) {
  const byKey = new Map(candidates.map((item) => [item.key, item]));
  return [...new Set(keys)].filter((key) => {
    const candidate = byKey.get(key);
    return candidate?.status === 'candidate' && bucketOf(candidate, thresholds) === bucket;
  });
}

export type TriageSort = 'default' | 'relevance-desc' | 'relevance-asc' | 'quality-desc';
export function sortByScore(candidates: Candidate[], sort: TriageSort) {
  if (sort === 'default') return candidates;
  const score = (candidate: Candidate) =>
    sort === 'quality-desc' ? (candidate.suggestion?.quality ?? -1) : (candidate.suggestion?.relevance ?? -1);
  const direction = sort === 'relevance-asc' ? 1 : -1;
  return [...candidates].sort((a, b) => {
    const left = score(a);
    const right = score(b);
    // Papers without a score stay at the end either way.
    if (left < 0 || right < 0) return right - left;
    return direction * (left - right);
  });
}
