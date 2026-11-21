// Neighbourhood ranking for the lab KG explorer (L4). The worker collects links hop by hop; this module weighs
// the nodes, keeps the strongest ones within the limit and drops edges whose ends were cut. It is pure so the
// ranking can be tested without D1.
import {
  KG_GRAPH_KIND_LAYER,
  KG_GRAPH_NODE_KINDS,
  type KgGraphEdge,
  type KgGraphLayer,
  type KgGraphNode,
} from '../schemas/labKg';
import { impactScore } from './search';

export type KgNodeInfo = Omit<KgGraphNode, 'weight' | 'depth'>;

/** One edge found while expanding `via`, leading to `node`. */
export interface KgLink {
  via: string;
  node: KgNodeInfo;
  edge: KgGraphEdge;
}

/** A second-hop node weighs its edge times the weight of the node it was reached from, times this factor. */
export const KG_GRAPH_HOP_DECAY = 0.5;
/** Depth 2 expands only this many of the strongest first-hop nodes. */
export const KG_GRAPH_FRONTIER = 8;
/** Each relation of an expanded node returns at most this many rows, so one relation cannot crowd out the rest. */
export const KG_GRAPH_PER_RELATION = 40;
/** Cited works outside the KG listed for the centre paper. */
export const KG_GRAPH_OUTSIDE_LIMIT = 50;

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;

/** Edge weights in [0, 1]. Strong curated links (`builds_on`, the topic hierarchy) weigh 1. */
export const kgEdgeWeight = {
  cites: (citations: number | null) => round(0.5 + 0.5 * impactScore(citations)),
  authored: (position: number) => round(Math.max(0.4, 1 - 0.1 * (position - 1))),
  coauthor: (count: number) => round(count / 3),
  topic: (score: number | null) => round(score ?? 0.5),
  score: (score: number) => round(score),
  affiliated: 0.6,
  hierarchy: 1,
  buildsOn: 1,
};

const UNDIRECTED = new Set<KgGraphEdge['type']>(['cooccur', 'coauthor']);

export function kgEdgeKey({ type, source, target }: KgGraphEdge) {
  const [left, right] = UNDIRECTED.has(type) && target < source ? [target, source] : [source, target];
  return `${type}|${left}|${right}`;
}

/** The centre first, then heavier, nearer nodes; kind order and ID break ties so the order is stable. */
function compareRank(a: KgGraphNode, b: KgGraphNode) {
  if (a.depth === 0 || b.depth === 0) return a.depth - b.depth;
  return (
    b.weight - a.weight ||
    a.depth - b.depth ||
    KG_GRAPH_NODE_KINDS.indexOf(a.kind) - KG_GRAPH_NODE_KINDS.indexOf(b.kind) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The first-hop nodes a depth-2 request expands: the strongest ones, institutions excepted. */
export function kgFrontier(nodes: Iterable<KgGraphNode>, size = KG_GRAPH_FRONTIER) {
  return [...nodes]
    .filter(({ depth, kind }) => depth === 1 && kind !== 'institution')
    .sort(compareRank)
    .slice(0, size);
}

/** Weighs the nodes reached hop by hop and keeps the centre plus the `limit − 1` strongest neighbours. */
export function assembleKgGraph({
  centre,
  hops,
  layers,
  limit,
}: {
  centre: KgNodeInfo;
  hops: KgLink[][];
  layers: ReadonlySet<KgGraphLayer>;
  limit: number;
}) {
  const nodes = new Map<string, KgGraphNode>([[centre.id, { ...centre, weight: 1, depth: 0 }]]);
  const edges = new Map<string, KgGraphEdge>();
  hops.forEach((links, index) => {
    const depth = (index + 1) as 1 | 2;
    for (const link of links) {
      const via = nodes.get(link.via);
      if (!via || via.depth >= depth) continue;
      if (link.node.id !== centre.id && !layers.has(KG_GRAPH_KIND_LAYER[link.node.kind])) continue;
      const weight = round(
        via.depth === 0 ? link.edge.weight : via.weight * link.edge.weight * KG_GRAPH_HOP_DECAY,
      );
      const known = nodes.get(link.node.id);
      if (!known) nodes.set(link.node.id, { ...link.node, weight, depth });
      else if (known.depth !== 0 && weight > known.weight && known.depth === depth) known.weight = weight;
      const key = kgEdgeKey(link.edge);
      const edge = { ...link.edge, weight: round(link.edge.weight) };
      const previous = edges.get(key);
      if (!previous || edge.weight > previous.weight) edges.set(key, edge);
    }
  });
  const ranked = [...nodes.values()].sort(compareRank);
  const kept = ranked.slice(0, Math.max(1, limit));
  const ids = new Set(kept.map(({ id }) => id));
  return {
    nodes: kept,
    edges: [...edges.entries()]
      .filter(([, { source, target }]) => ids.has(source) && ids.has(target))
      .sort(
        ([leftKey, left], [rightKey, right]) => right.weight - left.weight || (leftKey < rightKey ? -1 : 1),
      )
      .map(([, edge]) => edge),
    truncated: ranked.length > kept.length,
  };
}

/** Builds the trend table: a contiguous year axis and each keyword's count per year. */
export function kgTrendTable(
  keywords: { id: string; text: string; total: number }[],
  rows: { keywordId: string; year: number; count: number }[],
) {
  const seen = [...new Set(rows.map(({ year }) => year))].sort((a, b) => a - b);
  const first = seen[0];
  const last = seen.at(-1);
  const years =
    first === undefined || last === undefined
      ? []
      : last - first <= 100
        ? Array.from({ length: last - first + 1 }, (_, index) => first + index)
        : seen;
  return {
    years,
    keywords: keywords.map((keyword) => {
      const byYear = new Map(
        rows.filter(({ keywordId }) => keywordId === keyword.id).map(({ year, count }) => [year, count]),
      );
      return { ...keyword, counts: years.map((year) => byYear.get(year) ?? 0) };
    }),
  };
}
