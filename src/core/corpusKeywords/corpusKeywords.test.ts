import { expect, it } from 'vitest';
import { CorpusKeywordsSchema, type KeywordPaper } from '../schemas/corpusKeywords';
import {
  aggregateKeywords,
  buildCorpusKeywords,
  cloudWords,
  isKeywordCollectionStale,
  keywordGraph,
  memberDigest,
  papersInYear,
} from './index';

const kw = (slug: string, score: number) => ({ id: `keywords/${slug}`, name: slug, score });
const papers: KeywordPaper[] = [
  { memberId: 'm1', year: 2020, keywords: [kw('alpha', 0.8), kw('beta', 0.6)] },
  { memberId: 'm2', year: 2021, keywords: [kw('alpha', 0.4), kw('beta', 0.2), kw('gamma', 0.5)] },
  { memberId: 'm3', year: 2021, keywords: [kw('alpha', 0.6)] },
  { memberId: 'm4', year: null, keywords: [] },
];

it('counts papers, share, mean score and years per keyword', () => {
  const result = aggregateKeywords(papers);
  expect(result.papersWithKeywords).toBe(3);
  expect(result.papersByYear).toEqual({ '2020': 1, '2021': 2 });
  expect(result.keywords.map((item) => item.id)).toEqual([
    'keywords/alpha',
    'keywords/beta',
    'keywords/gamma',
  ]);
  const [alpha, beta] = result.keywords;
  expect(alpha).toMatchObject({
    paperCount: 3,
    share: 1,
    paperIds: ['m1', 'm2', 'm3'],
    years: { '2020': 1, '2021': 2 },
  });
  expect(alpha?.meanScore).toBeCloseTo(0.6);
  expect(beta).toMatchObject({ paperCount: 2, paperIds: ['m1', 'm2'] });
  expect(beta?.share).toBeCloseTo(2 / 3);
  expect(beta?.meanScore).toBeCloseTo(0.4);
});

it('counts a keyword repeated in one paper once', () => {
  const result = aggregateKeywords([
    { memberId: 'x', year: 2020, keywords: [kw('alpha', 0.2), kw('alpha', 0.9)] },
  ]);
  expect(result.keywords).toHaveLength(1);
  expect(result.keywords[0]?.paperCount).toBe(1);
  expect(result.pairs).toEqual([]);
});

it('measures co-occurrence with the Jaccard index', () => {
  const { pairs } = aggregateKeywords(papers);
  const ab = pairs.find((pair) => pair.a === 'keywords/alpha' && pair.b === 'keywords/beta');
  // alpha in 3 papers, beta in 2, together in 2: 2 / (3 + 2 - 2).
  expect(ab).toMatchObject({ count: 2 });
  expect(ab?.strength).toBeCloseTo(2 / 3);
  const bg = pairs.find((pair) => pair.a === 'keywords/beta' && pair.b === 'keywords/gamma');
  expect(bg?.strength).toBeCloseTo(1 / 2);
  expect(pairs[0]).toBe(ab);
  expect(aggregateKeywords(papers, 1).pairs).toHaveLength(1);
});

it('builds a storable collection and notices member changes', () => {
  const collection = buildCorpusKeywords({
    corpusId: 'c',
    memberIds: ['m1', 'm2', 'm3', 'm4'],
    papers,
    computedAt: '2026-11-18T00:00:00.000Z',
  });
  expect(CorpusKeywordsSchema.parse(collection)).toEqual(collection);
  expect(collection.memberCount).toBe(4);
  expect(isKeywordCollectionStale(collection, ['m4', 'm3', 'm2', 'm1'])).toBe(false);
  expect(isKeywordCollectionStale(collection, ['m1', 'm2', 'm3'])).toBe(true);
  expect(isKeywordCollectionStale(collection, ['m1', 'm2', 'm3', 'm5'])).toBe(true);
  expect(memberDigest(['b', 'a'])).toBe(memberDigest(['a', 'b']));
});

it('filters papers by year', () => {
  expect(papersInYear(papers, 2021).map((paper) => paper.memberId)).toEqual(['m2', 'm3']);
  expect(papersInYear(papers, null)).toHaveLength(4);
  expect(aggregateKeywords(papersInYear(papers, 2021)).keywords[0]).toMatchObject({
    id: 'keywords/alpha',
    share: 1,
  });
});

it('sizes cloud words by paper count and tones them by mean score', () => {
  const words = cloudWords(aggregateKeywords(papers).keywords);
  expect(words.map((word) => word.name)).toEqual(['alpha', 'beta', 'gamma']);
  expect(words.map((word) => word.size)).toEqual([6, 5, 1]);
  expect(words.map((word) => word.tone)).toEqual([3, 2, 3]);
});

it('keeps the graph to the top keywords and strong edges', () => {
  const aggregate = aggregateKeywords(papers);
  const graph = keywordGraph(aggregate, { top: 2 });
  expect(graph.nodes.map((node) => node.id)).toEqual(['keywords/alpha', 'keywords/beta']);
  expect(graph.nodes[0]?.r).toBeGreaterThan(graph.nodes[1]?.r ?? 0);
  expect(graph.edges).toEqual([{ a: 'keywords/alpha', b: 'keywords/beta', count: 2, strength: 2 / 3 }]);
  expect(keywordGraph(aggregate, { minStrength: 0.9 }).edges).toEqual([]);
  expect(keywordGraph(aggregate, { minCount: 1 }).edges).toHaveLength(3);
  expect(keywordGraph(aggregate)).toEqual(keywordGraph(aggregate));
});
