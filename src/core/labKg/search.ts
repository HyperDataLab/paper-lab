// Pure scoring for `POST /v1/kg/search`: the worker gathers per-paper signals from D1 and Vectorize, and these
// helpers turn them into one score per paper. Imports are relative because the worker imports this file.
import {
  KEYWORD_SCORE,
  TITLE_CONFIDENCE,
  type SciAtlasLevel,
  type SciAtlasRanking,
} from '../openkg/sciatlas';
import { normalizeText } from './openAlex';

export type KgSearchMode = 'keyword' | 'semantic' | 'title' | 'hybrid';

/** Keyword weight per level: the SciAtlas keyword score divided by the high score (high 1, middle ≈0.78, low ≈0.44). */
export const KG_KEYWORD_WEIGHT: Record<SciAtlasLevel, number> = {
  high: 1,
  middle: KEYWORD_SCORE.middle / KEYWORD_SCORE.high,
  low: KEYWORD_SCORE.low / KEYWORD_SCORE.high,
};
/** Title weight per level: the SciAtlas title confidence (0.95 / 0.85 / 0.65). */
export const KG_TITLE_WEIGHT: Record<SciAtlasLevel, number> = TITLE_CONFIDENCE;

/** How much each retrieval channel counts towards text relevance in each mode. */
export const KG_MODE_WEIGHTS: Record<
  KgSearchMode,
  { fts: number; keyword: number; title: number; vector: number }
> = {
  keyword: { fts: 0.4, keyword: 0.6, title: 0, vector: 0 },
  semantic: { fts: 0, keyword: 0, title: 0, vector: 1 },
  title: { fts: 0, keyword: 0, title: 1, vector: 0 },
  hybrid: { fts: 0.2, keyword: 0.3, title: 0.15, vector: 0.35 },
};

/** Graph boosts and how they combine; relevance = (1 − GRAPH_SHARE) · text + GRAPH_SHARE · graph. */
export const KG_GRAPH_WEIGHTS = { sharedHigh: 0.5, citation: 0.3, cooccur: 0.2 } as const;
export const KG_GRAPH_SHARE = 0.2;

/** Final score = relevance · r + impact · i + novelty · n per ranking profile (each row sums to 1). */
export const KG_RANKING_PROFILES: Record<
  SciAtlasRanking,
  { relevance: number; impact: number; novelty: number }
> = {
  precision: { relevance: 0.9, impact: 0.05, novelty: 0.05 },
  balanced: { relevance: 0.7, impact: 0.15, novelty: 0.15 },
  discovery: { relevance: 0.6, impact: 0.05, novelty: 0.35 },
  impact: { relevance: 0.55, impact: 0.4, novelty: 0.05 },
};

/** Citation count at which impact saturates at 1 (log scale). */
export const KG_IMPACT_SATURATION = 1000;
/** Years over which recency falls from 1 (this year) to 0. */
export const KG_RECENCY_YEARS = 10;

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Channel signals for one candidate paper, each in [0, 1] (missing = 0). */
export interface KgSignals {
  fts?: number;
  keyword?: number;
  title?: number;
  vector?: number;
  sharedHigh?: number;
  citation?: number;
  cooccur?: number;
}

export interface KgCandidate {
  id: string;
  year: number | null;
  citations: number | null;
  signals: KgSignals;
}

/** Up to 32 distinct normalised tokens of the texts, each quoted and joined with OR, safe to pass to FTS5 MATCH. */
export function ftsQuery(texts: string[], column?: 'title' | 'abstract' | 'text') {
  const tokens = [
    ...new Set(
      texts.flatMap((value) =>
        normalizeText(value)
          .split(' ')
          .filter((token) => token.length > 1),
      ),
    ),
  ].slice(0, 32);
  if (!tokens.length) return null;
  const joined = tokens.map((token) => `"${token}"`).join(' OR ');
  return column ? `${column} : (${joined})` : joined;
}

/** One FTS5 phrase for a keyword, or null when it has no searchable token. */
export function ftsPhrase(value: string) {
  const text = normalizeText(value);
  return text ? `"${text}"` : null;
}

/** FTS5 `bm25()` is negative with lower meaning better; map a result set to [0, 1] with the best match at 1. */
export function normalizeBm25(rows: { id: string; rank: number }[]) {
  const best = Math.max(0, ...rows.map(({ rank }) => -rank));
  return new Map(rows.map(({ id, rank }) => [id, best > 0 ? clamp(-rank / best) : 1]));
}

/** Token overlap (Dice) of two titles after normalisation; 1 for an exact normalised match. */
export function titleSimilarity(left: string, right: string) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return (2 * shared) / (tokensA.size + tokensB.size);
}

/** Best level-weighted similarity of a paper title to any title anchor. */
export function titleScore(paperTitle: string, anchors: { title: string; level: SciAtlasLevel }[]) {
  return Math.max(
    0,
    ...anchors.map(({ title, level }) => titleSimilarity(paperTitle, title) * KG_TITLE_WEIGHT[level]),
  );
}

/**
 * Keyword signal of one paper: the level weights of the anchors it matches (scaled by the paper's OpenAlex
 * relevance for that keyword, 0.5 when unknown), divided by the sum of all anchor weights.
 */
export function keywordScore(
  matches: { level: SciAtlasLevel; relevance: number | null }[],
  anchors: { level: SciAtlasLevel }[],
) {
  const total = anchors.reduce((sum, { level }) => sum + KG_KEYWORD_WEIGHT[level], 0);
  if (!total) return 0;
  const got = matches.reduce(
    (sum, { level, relevance }) => sum + KG_KEYWORD_WEIGHT[level] * (0.5 + 0.5 * clamp(relevance ?? 0)),
    0,
  );
  return clamp(got / total);
}

export function impactScore(citations: number | null) {
  return citations && citations > 0 ? clamp(Math.log1p(citations) / Math.log1p(KG_IMPACT_SATURATION)) : 0;
}

export function recencyScore(year: number | null, currentYear: number) {
  return year === null ? 0 : clamp(1 - (currentYear - year) / KG_RECENCY_YEARS);
}

/** Novelty favours recent and little-cited papers: 0.6 · recency + 0.4 · (1 − impact). */
export function noveltyScore(year: number | null, citations: number | null, currentYear: number) {
  return 0.6 * recencyScore(year, currentYear) + 0.4 * (1 - impactScore(citations));
}

export function textRelevance(signals: KgSignals, mode: KgSearchMode) {
  const weights = KG_MODE_WEIGHTS[mode];
  return clamp(
    weights.fts * (signals.fts ?? 0) +
      weights.keyword * (signals.keyword ?? 0) +
      weights.title * (signals.title ?? 0) +
      weights.vector * (signals.vector ?? 0),
  );
}

export function graphBoost(signals: KgSignals) {
  return clamp(
    KG_GRAPH_WEIGHTS.sharedHigh * (signals.sharedHigh ?? 0) +
      KG_GRAPH_WEIGHTS.citation * (signals.citation ?? 0) +
      KG_GRAPH_WEIGHTS.cooccur * (signals.cooccur ?? 0),
  );
}

export function relevanceScore(signals: KgSignals, mode: KgSearchMode) {
  return (1 - KG_GRAPH_SHARE) * textRelevance(signals, mode) + KG_GRAPH_SHARE * graphBoost(signals);
}

export function kgScore(
  candidate: KgCandidate,
  mode: KgSearchMode,
  ranking: SciAtlasRanking,
  currentYear: number,
) {
  const profile = KG_RANKING_PROFILES[ranking];
  const relevance = relevanceScore(candidate.signals, mode);
  // Only hybrid lets a paper in on graph links alone; the other modes need a hit in their own channel.
  if (relevance <= 0 || (mode !== 'hybrid' && textRelevance(candidate.signals, mode) <= 0)) return 0;
  return (
    profile.relevance * relevance +
    profile.impact * impactScore(candidate.citations) +
    profile.novelty * noveltyScore(candidate.year, candidate.citations, currentYear)
  );
}

/** Year bounds from `after` / `before` days; D1 holds only a publication year, so the filter works by year. */
export function yearRange(after?: string, before?: string) {
  return {
    from: after ? Number(after.slice(0, 4)) : null,
    to: before ? Number(before.slice(0, 4)) : null,
  };
}

export function inYearRange(year: number | null, range: { from: number | null; to: number | null }) {
  if (range.from === null && range.to === null) return true;
  if (year === null) return false;
  return (range.from === null || year >= range.from) && (range.to === null || year <= range.to);
}

/**
 * Scores and orders candidates. Papers with no relevance, outside the year range or excluded are dropped.
 * Ties fall back to more citations, then the smaller id.
 */
export function rankKgCandidates(
  candidates: KgCandidate[],
  options: {
    mode: KgSearchMode;
    ranking: SciAtlasRanking;
    currentYear: number;
    topK: number;
    years?: { from: number | null; to: number | null };
    exclude?: ReadonlySet<string>;
  },
) {
  const years = options.years ?? { from: null, to: null };
  return candidates
    .filter(({ id, year }) => !options.exclude?.has(id) && inYearRange(year, years))
    .map((candidate) => ({
      candidate,
      score: kgScore(candidate, options.mode, options.ranking, options.currentYear),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.candidate.citations ?? 0) - (a.candidate.citations ?? 0) ||
        (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0),
    )
    .slice(0, options.topK);
}
