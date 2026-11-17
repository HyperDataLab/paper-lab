import type { CorpusKeyword, CorpusKeywords, KeywordPair, KeywordPaper } from '../schemas/corpusKeywords';

/**
 * Pairs kept in a stored collection. Pairs are ranked by count, then strength, so a cut drops the pairs seen in one
 * paper first; the graph only draws pairs seen in two or more papers anyway.
 */
export const MAX_KEYWORD_PAIRS = 3000;

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const addYear = (years: Record<string, number>, year: number | null) => {
  if (year === null) return;
  const key = String(year);
  years[key] = (years[key] ?? 0) + 1;
};

export interface KeywordAggregate {
  papersWithKeywords: number;
  papersByYear: Record<string, number>;
  keywords: CorpusKeyword[];
  pairs: KeywordPair[];
}

/**
 * Per keyword: how many papers carry it, its share of the papers that have any keyword, its mean OpenAlex score and
 * a year histogram. Per pair of keywords in the same paper: the count and the Jaccard index
 * `count / (papers with a + papers with b − count)`, which is 1 when the two always appear together and does not
 * grow just because both keywords are common. Output order is deterministic (count desc, then id).
 */
export function aggregateKeywords(papers: KeywordPaper[], maxPairs = MAX_KEYWORD_PAIRS): KeywordAggregate {
  const entries = new Map<
    string,
    { name: string; scores: number[]; paperIds: string[]; years: Record<string, number> }
  >();
  const pairCounts = new Map<string, number>();
  const papersByYear: Record<string, number> = {};
  let papersWithKeywords = 0;
  for (const paper of papers) {
    const unique = [...new Map(paper.keywords.map((keyword) => [keyword.id, keyword])).values()].sort(byId);
    if (!unique.length) continue;
    papersWithKeywords++;
    addYear(papersByYear, paper.year);
    for (const keyword of unique) {
      const entry = entries.get(keyword.id) ?? { name: keyword.name, scores: [], paperIds: [], years: {} };
      entry.scores.push(keyword.score);
      entry.paperIds.push(paper.memberId);
      addYear(entry.years, paper.year);
      entries.set(keyword.id, entry);
    }
    for (let i = 0; i < unique.length; i++)
      for (let j = i + 1; j < unique.length; j++) {
        const key = `${unique[i]?.id}\u0000${unique[j]?.id}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
  }
  const keywords: CorpusKeyword[] = [...entries]
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      paperCount: entry.paperIds.length,
      share: papersWithKeywords ? entry.paperIds.length / papersWithKeywords : 0,
      meanScore: entry.scores.reduce((sum, score) => sum + score, 0) / entry.scores.length,
      paperIds: [...entry.paperIds].sort(),
      years: entry.years,
    }))
    .sort((a, b) => b.paperCount - a.paperCount || a.id.localeCompare(b.id));
  const counts = new Map(keywords.map((keyword) => [keyword.id, keyword.paperCount]));
  const pairs: KeywordPair[] = [...pairCounts]
    .map(([key, count]) => {
      const [a = '', b = ''] = key.split('\u0000');
      const union = (counts.get(a) ?? 0) + (counts.get(b) ?? 0) - count;
      return { a, b, count, strength: union > 0 ? count / union : 0 };
    })
    .sort(
      (x, y) =>
        y.count - x.count || y.strength - x.strength || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
    )
    .slice(0, maxPairs);
  return { papersWithKeywords, papersByYear, keywords, pairs };
}

/** FNV-1a over the sorted member ids: enough to notice that the member list changed, not a security hash. */
export function memberDigest(memberIds: string[]) {
  let hash = 0x811c9dc5;
  for (const char of [...memberIds].sort().join('\n')) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${memberIds.length}:${hash.toString(16).padStart(8, '0')}`;
}

export function buildCorpusKeywords(input: {
  corpusId: string;
  memberIds: string[];
  papers: KeywordPaper[];
  computedAt: string;
}): CorpusKeywords {
  return {
    schemaVersion: 1,
    corpusId: input.corpusId,
    computedAt: input.computedAt,
    memberCount: input.memberIds.length,
    memberDigest: memberDigest(input.memberIds),
    papers: input.papers,
    ...aggregateKeywords(input.papers),
  };
}

/** True when the corpus members are no longer those the collection was built from. */
export function isKeywordCollectionStale(collection: CorpusKeywords, memberIds: string[]) {
  return collection.memberCount !== memberIds.length || collection.memberDigest !== memberDigest(memberIds);
}

/** Papers of one publication year; null keeps every paper. */
export function papersInYear(papers: KeywordPaper[], year: number | null) {
  return year === null ? papers : papers.filter((paper) => paper.year === year);
}

export interface CloudWord {
  id: string;
  name: string;
  paperCount: number;
  meanScore: number;
  /** 1 (smallest) to 6, from paperCount on a square-root scale. */
  size: number;
  /** 1 (faint) to 4 (strong), from meanScore. */
  tone: number;
}

/** The most frequent keywords for a word cloud, in alphabetical order so the layout does not jump. */
export function cloudWords(keywords: CorpusKeyword[], limit = 80): CloudWord[] {
  const top = keywords.slice(0, limit);
  const max = Math.max(1, ...top.map((keyword) => keyword.paperCount));
  return top
    .map((keyword) => ({
      id: keyword.id,
      name: keyword.name,
      paperCount: keyword.paperCount,
      meanScore: keyword.meanScore,
      size: max === 1 ? 3 : 1 + Math.round(5 * Math.sqrt((keyword.paperCount - 1) / (max - 1))),
      tone: Math.min(4, 1 + Math.floor(Math.max(0, keyword.meanScore) * 4)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export interface GraphNode {
  id: string;
  name: string;
  paperCount: number;
  x: number;
  y: number;
  r: number;
}
export interface GraphEdge {
  a: string;
  b: string;
  count: number;
  strength: number;
}
export const GRAPH_SIZE = 800;
/** Room outside the ring for the labels. */
const LABEL_MARGIN = 150;

/**
 * The co-occurrence graph of the `top` most frequent keywords, laid out on a circle by frequency (deterministic).
 * Only pairs seen in at least `minCount` papers with a Jaccard strength of at least `minStrength` are drawn, at most
 * `maxEdges` of them, so the figure stays readable.
 */
export function keywordGraph(
  aggregate: Pick<KeywordAggregate, 'keywords' | 'pairs'>,
  options: { top?: number; minStrength?: number; minCount?: number; maxEdges?: number } = {},
) {
  const { top = 40, minStrength = 0.1, minCount = 2, maxEdges = 120 } = options;
  const chosen = aggregate.keywords.slice(0, top);
  const max = Math.max(1, ...chosen.map((keyword) => keyword.paperCount));
  const centre = GRAPH_SIZE / 2;
  const ring = centre - LABEL_MARGIN;
  const nodes: GraphNode[] = chosen.map((keyword, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, chosen.length) - Math.PI / 2;
    return {
      id: keyword.id,
      name: keyword.name,
      paperCount: keyword.paperCount,
      x: Math.round((centre + ring * Math.cos(angle)) * 10) / 10,
      y: Math.round((centre + ring * Math.sin(angle)) * 10) / 10,
      r: Math.round((4 + 14 * Math.sqrt(keyword.paperCount / max)) * 10) / 10,
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = aggregate.pairs
    .filter(
      (pair) => ids.has(pair.a) && ids.has(pair.b) && pair.count >= minCount && pair.strength >= minStrength,
    )
    .sort(
      (x, y) =>
        y.strength - x.strength || y.count - x.count || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
    )
    .slice(0, maxEdges)
    .map(({ a, b, count, strength }) => ({ a, b, count, strength }));
  return { nodes, edges };
}
