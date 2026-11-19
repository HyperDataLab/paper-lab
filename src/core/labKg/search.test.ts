import { describe, expect, it } from 'vitest';
import {
  ftsPhrase,
  ftsQuery,
  graphBoost,
  impactScore,
  inYearRange,
  KG_KEYWORD_WEIGHT,
  KG_RANKING_PROFILES,
  kgScore,
  keywordScore,
  noveltyScore,
  normalizeBm25,
  rankKgCandidates,
  relevanceScore,
  titleScore,
  titleSimilarity,
  yearRange,
  type KgCandidate,
} from './search';

const YEAR = 2026;

describe('L3 lab KG scoring', () => {
  it('L3 keyword level weights follow the SciAtlas scores 9/7/4', () => {
    expect(KG_KEYWORD_WEIGHT.high).toBe(1);
    expect(KG_KEYWORD_WEIGHT.middle).toBeCloseTo(7 / 9);
    expect(KG_KEYWORD_WEIGHT.low).toBeCloseTo(4 / 9);
    const anchors = [{ level: 'high' as const }, { level: 'low' as const }];
    const high = keywordScore([{ level: 'high', relevance: 1 }], anchors);
    const low = keywordScore([{ level: 'low', relevance: 1 }], anchors);
    expect(high).toBeCloseTo(1 / (1 + 4 / 9));
    expect(high).toBeGreaterThan(low);
    // Unknown relevance counts half.
    expect(keywordScore([{ level: 'high', relevance: null }], [{ level: 'high' }])).toBe(0.5);
    expect(keywordScore([], [])).toBe(0);
  });

  it('L3 ranking profiles each sum to 1', () => {
    for (const profile of Object.values(KG_RANKING_PROFILES))
      expect(profile.relevance + profile.impact + profile.novelty).toBeCloseTo(1);
  });

  it('L3 ranking profiles trade relevance against citations and novelty', () => {
    const classic: KgCandidate = {
      id: 'W1',
      year: 2005,
      citations: 5000,
      signals: { fts: 0.8, keyword: 0.8 },
    };
    const fresh: KgCandidate = { id: 'W2', year: 2025, citations: 1, signals: { fts: 0.7, keyword: 0.7 } };
    const order = (ranking: keyof typeof KG_RANKING_PROFILES) =>
      rankKgCandidates([classic, fresh], { mode: 'keyword', ranking, currentYear: YEAR, topK: 10 }).map(
        ({ candidate }) => candidate.id,
      );
    expect(order('impact')).toEqual(['W1', 'W2']);
    expect(order('discovery')).toEqual(['W2', 'W1']);
    expect(order('precision')).toEqual(['W1', 'W2']);
  });

  it('L3 impact and novelty scales', () => {
    expect(impactScore(null)).toBe(0);
    expect(impactScore(1000)).toBeCloseTo(1);
    expect(impactScore(10_000)).toBe(1);
    expect(impactScore(10)).toBeGreaterThan(impactScore(1));
    expect(noveltyScore(YEAR, 0, YEAR)).toBe(1);
    expect(noveltyScore(null, 1000, YEAR)).toBeCloseTo(0);
    expect(noveltyScore(YEAR - 5, 0, YEAR)).toBeCloseTo(0.7);
  });

  it('L3 modes use only their own channels, and only hybrid admits graph-only papers', () => {
    const vectorOnly = { vector: 0.9 };
    expect(relevanceScore(vectorOnly, 'keyword')).toBe(0);
    expect(relevanceScore(vectorOnly, 'semantic')).toBeCloseTo(0.72);
    const graphOnly: KgCandidate = { id: 'W3', year: 2020, citations: 0, signals: { citation: 1 } };
    expect(kgScore(graphOnly, 'title', 'balanced', YEAR)).toBe(0);
    expect(kgScore(graphOnly, 'hybrid', 'balanced', YEAR)).toBeGreaterThan(0);
  });

  it('L3 graph boosts lift a paper sharing high keywords, citation links and co-occurrence', () => {
    expect(graphBoost({ sharedHigh: 1, citation: 1, cooccur: 1 })).toBe(1);
    expect(graphBoost({ citation: 1 })).toBeCloseTo(0.3);
    const base = { fts: 0.5, keyword: 0.5 };
    const plain: KgCandidate = { id: 'W1', year: 2020, citations: 10, signals: base };
    const linked: KgCandidate = { id: 'W2', year: 2020, citations: 10, signals: { ...base, citation: 1 } };
    const shared: KgCandidate = { id: 'W3', year: 2020, citations: 10, signals: { ...base, sharedHigh: 1 } };
    const ranked = rankKgCandidates([plain, linked, shared], {
      mode: 'hybrid',
      ranking: 'balanced',
      currentYear: YEAR,
      topK: 10,
    }).map(({ candidate }) => candidate.id);
    expect(ranked).toEqual(['W3', 'W2', 'W1']);
  });

  it('L3 year filter works on publication years and drops unknown years when set', () => {
    const range = yearRange('2018-01-01', '2022-12-31');
    expect(range).toEqual({ from: 2018, to: 2022 });
    expect(inYearRange(2018, range)).toBe(true);
    expect(inYearRange(2023, range)).toBe(false);
    expect(inYearRange(null, range)).toBe(false);
    expect(inYearRange(null, yearRange())).toBe(true);
    expect(inYearRange(1990, yearRange(undefined, '2000-01-01'))).toBe(true);
    const ranked = rankKgCandidates(
      [
        { id: 'W1', year: 2017, citations: 0, signals: { fts: 1 } },
        { id: 'W2', year: 2019, citations: 0, signals: { fts: 1 } },
      ],
      { mode: 'keyword', ranking: 'balanced', currentYear: YEAR, topK: 10, years: range },
    );
    expect(ranked.map(({ candidate }) => candidate.id)).toEqual(['W2']);
  });

  it('L3 ranking drops excluded papers, caps topK and breaks ties by citations then id', () => {
    const same = { fts: 0.5 };
    const ranked = rankKgCandidates(
      [
        { id: 'W3', year: 2020, citations: 5, signals: same },
        { id: 'W2', year: 2020, citations: 5, signals: same },
        { id: 'W9', year: 2020, citations: 5, signals: same },
        { id: 'W1', year: 2020, citations: 5, signals: { fts: 0 } },
      ],
      { mode: 'keyword', ranking: 'precision', currentYear: YEAR, topK: 2, exclude: new Set(['W9']) },
    );
    expect(ranked.map(({ candidate }) => candidate.id)).toEqual(['W2', 'W3']);
  });

  it('L3 FTS queries quote every token so operators cannot break MATCH', () => {
    expect(ftsQuery(['Graph-neural "nets" NOT: AND x'])).toBe(
      '"graph" OR "neural" OR "nets" OR "not" OR "and"',
    );
    expect(ftsQuery(['A title'], 'title')).toBe('title : ("title")');
    expect(ftsQuery(['?!'])).toBeNull();
    expect(ftsPhrase('Graph "Neural"')).toBe('"graph neural"');
    expect(ftsPhrase('—')).toBeNull();
  });

  it('L3 bm25 ranks map to [0, 1] with the best at 1', () => {
    const scores = normalizeBm25([
      { id: 'W1', rank: -4 },
      { id: 'W2', rank: -1 },
    ]);
    expect(scores.get('W1')).toBe(1);
    expect(scores.get('W2')).toBe(0.25);
  });

  it('L3 title similarity is token Dice, weighted by the anchor level', () => {
    expect(titleSimilarity('Graph Models!', 'graph models')).toBe(1);
    expect(titleSimilarity('graph models of x', 'graph models of y')).toBeCloseTo(0.75);
    expect(titleSimilarity('', 'x')).toBe(0);
    expect(titleScore('graph models', [{ title: 'Graph models', level: 'middle' }])).toBeCloseTo(0.85);
    expect(titleScore('graph models', [])).toBe(0);
  });
});
