import { normalizeDoi } from '../library/doi';
import { scgNameKey } from './index';
import type { CorpusMember } from '../schemas/corpus';
import type { ScgContributionType, ScgPaperRun, ScgReference, ScgReview } from '../schemas';

/**
 * The corpus "Lộ trình đóng góp": the SCG runs of a corpus's members merged into one graph.
 *
 * An edge runs from the dependent contribution to what it builds on, so `ancestors` follows edges ("what it
 * builds on") and `descendants` goes against them ("what builds on it"). Targets inside the corpus are
 * resolved through the contribution ids present in the members' runs, never through an id prefix.
 */
export type RoadmapMember = Pick<CorpusMember, 'memberId' | 'title' | 'identifiers' | 'stratum'>;

export type RoadmapContributionNode = {
  kind: 'contribution';
  id: string;
  name: string;
  description: string;
  paperId: string;
  memberId: string;
  /** The member's title, for "which paper". */
  paperTitle: string;
  year: number | null;
  types: ScgContributionType[];
  review: ScgReview;
};
/** Something outside the corpus's contributions that a prerequisite points to, grouped by DOI, title or URL. */
export type RoadmapExternalNode = {
  kind: 'external';
  id: string;
  name: string;
  year: number | null;
  doi: string | null;
  url: string | null;
  /** The corpus member this reference is (by DOI or S2 corpus id), when none of its contributions matched. */
  memberId: string | null;
};
export type RoadmapNode = RoadmapContributionNode | RoadmapExternalNode;

export type RoadmapEdge = {
  /** `<prerequisiteId>→<target>`. */
  id: string;
  /** The dependent contribution. */
  from: string;
  /** What it builds on. */
  to: string;
  prerequisiteId: string;
  prerequisiteName: string;
  coreOrPeripheral: 'core' | 'peripheral';
  explanation: string;
  /** Sentences of the dependent's paper that state the dependency. */
  sourceSentenceKeys: string[];
  /** The dependent's paper, where the evidence sentences are. */
  paperId: string;
  via: 'match' | 'contribution' | 'paper' | 'tool' | 'name';
  matchType: 'strong' | 'weak' | null;
  /** The weakest of the parts: accepted only when the prerequisite, the match and both endpoints are. */
  review: 'candidate' | 'accepted';
};

export type RoadmapCoverage = {
  members: number;
  /** Members with an SCG run (any of their paper ids). */
  withRun: number;
  /** Of those, runs that finished all three stages. */
  complete: number;
};

export type RoadmapChain = {
  /** Nodes reached, with their distance from the start (the start itself is not listed). */
  nodes: { node: RoadmapNode; depth: number }[];
  edges: RoadmapEdge[];
};

export type BuiltUpon = {
  node: RoadmapContributionNode;
  score: number;
  core: number;
  peripheral: number;
  /** Distinct papers whose contributions build on it. */
  papers: number;
};

/** Weight of an edge in `mostBuiltUpon`: building on something as core counts twice a peripheral use. */
export const SCG_EDGE_WEIGHT = { core: 2, peripheral: 1 } as const;

export type ScgRoadmap = {
  nodes: Map<string, RoadmapNode>;
  edges: RoadmapEdge[];
  coverage: RoadmapCoverage;
  contributions: () => RoadmapContributionNode[];
  ancestors: (id: string, depth: number) => RoadmapChain;
  descendants: (id: string, depth: number) => RoadmapChain;
  mostBuiltUpon: (limit: number) => BuiltUpon[];
  typeCounts: () => Map<ScgContributionType, number>;
};

const normDoi = (doi: string) => normalizeDoi(doi) ?? doi.trim().toLowerCase();

export function buildScgRoadmap(
  runs: ScgPaperRun[],
  members: RoadmapMember[],
  options: { acceptedOnly?: boolean } = {},
): ScgRoadmap {
  const kept = (review: ScgReview) => (options.acceptedOnly ? review === 'accepted' : review !== 'rejected');
  const byPaper = new Map(runs.map((run) => [run.paperId, run]));
  const memberRuns: { member: RoadmapMember; run: ScgPaperRun }[] = [];
  for (const member of members) {
    const run = member.identifiers.paperIds.map((id) => byPaper.get(id)).find(Boolean);
    if (run) memberRuns.push({ member, run });
  }
  const coverage: RoadmapCoverage = {
    members: members.length,
    withRun: memberRuns.length,
    complete: memberRuns.filter(({ run }) => run.status === 'complete').length,
  };

  const nodes = new Map<string, RoadmapNode>();
  // A reference to a corpus paper, by DOI or S2 corpus id, resolves to that member, with a run or not.
  const memberByDoi = new Map<string, string>();
  const memberByS2 = new Map<string, string>();
  for (const member of members)
    for (const doi of [member.identifiers.doi, ...(member.identifiers.doiAliases ?? [])])
      if (doi) memberByDoi.set(normDoi(doi), member.memberId);
  // Non-rejected contributions, so an accepted-only view drops a link whose corpus match is still a candidate.
  const present = new Set<string>();
  for (const { member, run } of memberRuns) {
    const year = member.stratum.year ?? null;
    if (run.doi) memberByDoi.set(normDoi(run.doi), member.memberId);
    if (run.s2CorpusId) memberByS2.set(run.s2CorpusId, member.memberId);
    for (const contribution of run.contributions) {
      if (contribution.review !== 'rejected') present.add(contribution.id);
      if (!kept(contribution.review)) continue;
      nodes.set(contribution.id, {
        kind: 'contribution',
        id: contribution.id,
        name: contribution.name,
        description: contribution.description,
        paperId: run.paperId,
        memberId: member.memberId,
        paperTitle: member.title || member.identifiers.doi || member.memberId,
        year,
        types: contribution.types.map((t) => t.type),
        review: contribution.review,
      });
    }
  }
  const isContribution = (id: string) => nodes.get(id)?.kind === 'contribution';

  function external(reference: Exclude<ScgReference, { kind: 'contribution' }>): RoadmapExternalNode {
    if (reference.kind === 'tool')
      return {
        kind: 'external',
        id: `tool:${reference.url}`,
        name: reference.url,
        year: null,
        doi: null,
        url: reference.url,
        memberId: null,
      };
    const doi = reference.doi ? normDoi(reference.doi) : null;
    const memberId =
      (doi && memberByDoi.get(doi)) || (reference.s2CorpusId && memberByS2.get(reference.s2CorpusId)) || null;
    const id = doi ? `doi:${doi}` : `title:${scgNameKey(reference.title)}`;
    return { kind: 'external', id, name: reference.title, year: reference.year, doi, url: null, memberId };
  }
  const addExternal = (node: RoadmapExternalNode) => {
    const current = nodes.get(node.id);
    if (!current) nodes.set(node.id, node);
    else if (current.kind === 'external' && current.year === null && node.year !== null)
      nodes.set(node.id, { ...current, year: node.year });
    return node.id;
  };

  const edges: RoadmapEdge[] = [];
  for (const { run } of memberRuns) {
    for (const contribution of run.contributions) {
      const from = nodes.get(contribution.id);
      if (!from || from.kind !== 'contribution') continue;
      for (const prerequisite of contribution.prerequisites) {
        if (!kept(prerequisite.review)) continue;
        const targets = new Map<string, Pick<RoadmapEdge, 'via' | 'matchType'> & { review: ScgReview }>();
        for (const match of prerequisite.matches)
          if (kept(match.review) && isContribution(match.contributionId))
            targets.set(match.contributionId, {
              via: 'match',
              matchType: match.matchType,
              review: match.review,
            });
        for (const reference of prerequisite.references)
          if (reference.kind === 'contribution' && isContribution(reference.contributionId))
            targets.set(reference.contributionId, {
              via: 'contribution',
              matchType: null,
              review: 'accepted',
            });
        // Outside nodes only when nothing in the corpus matched, not when the match is hidden by a filter.
        const inCorpus =
          prerequisite.matches.some((m) => m.review !== 'rejected' && present.has(m.contributionId)) ||
          prerequisite.references.some((r) => r.kind === 'contribution' && present.has(r.contributionId));
        if (!targets.size && !inCorpus) {
          for (const reference of prerequisite.references)
            if (reference.kind !== 'contribution') {
              const node = external(reference);
              targets.set(addExternal(node), { via: reference.kind, matchType: null, review: 'accepted' });
            }
          if (!targets.size) {
            const key = scgNameKey(prerequisite.name);
            if (key)
              targets.set(
                addExternal({
                  kind: 'external',
                  id: `name:${key}`,
                  name: prerequisite.name,
                  year: null,
                  doi: null,
                  url: null,
                  memberId: null,
                }),
                { via: 'name', matchType: null, review: 'accepted' },
              );
          }
        }
        for (const [to, target] of targets) {
          if (to === contribution.id) continue;
          const toNode = nodes.get(to);
          const parts = [from.review, prerequisite.review, target.review];
          if (toNode?.kind === 'contribution') parts.push(toNode.review);
          edges.push({
            id: `${prerequisite.id}→${to}`,
            from: contribution.id,
            to,
            prerequisiteId: prerequisite.id,
            prerequisiteName: prerequisite.name,
            coreOrPeripheral: prerequisite.coreOrPeripheral,
            explanation: prerequisite.explanation || prerequisite.description,
            sourceSentenceKeys: prerequisite.sourceSentenceKeys,
            paperId: run.paperId,
            via: target.via,
            matchType: target.matchType,
            review: parts.every((review) => review === 'accepted') ? 'accepted' : 'candidate',
          });
        }
      }
    }
  }

  const outgoing = new Map<string, RoadmapEdge[]>();
  const incoming = new Map<string, RoadmapEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }
  /** Breadth-first to `depth`; a node is expanded once, so cycles end. */
  function walk(start: string, depth: number, forward: boolean): RoadmapChain {
    const seen = new Map<string, number>([[start, 0]]);
    const chainEdges: RoadmapEdge[] = [];
    let frontier = [start];
    for (let level = 1; level <= depth && frontier.length; level++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const edge of (forward ? outgoing : incoming).get(id) ?? []) {
          chainEdges.push(edge);
          const other = forward ? edge.to : edge.from;
          if (seen.has(other)) continue;
          seen.set(other, level);
          next.push(other);
        }
      frontier = next;
    }
    seen.delete(start);
    return {
      nodes: [...seen].flatMap(([id, level]) => {
        const node = nodes.get(id);
        return node ? [{ node, depth: level }] : [];
      }),
      edges: chainEdges,
    };
  }

  const contributions = () =>
    [...nodes.values()].filter((node): node is RoadmapContributionNode => node.kind === 'contribution');

  return {
    nodes,
    edges,
    coverage,
    contributions,
    ancestors: (id, depth) => walk(id, depth, true),
    descendants: (id, depth) => walk(id, depth, false),
    mostBuiltUpon(limit) {
      const result: BuiltUpon[] = [];
      for (const node of contributions()) {
        // One dependent counts once per target, at its strongest use, however many prerequisites name it.
        const strongest = new Map<string, RoadmapEdge>();
        for (const edge of incoming.get(node.id) ?? []) {
          const current = strongest.get(edge.from);
          if (!current || (current.coreOrPeripheral === 'peripheral' && edge.coreOrPeripheral === 'core'))
            strongest.set(edge.from, edge);
        }
        if (!strongest.size) continue;
        const uses = [...strongest.values()];
        const core = uses.filter((edge) => edge.coreOrPeripheral === 'core').length;
        const peripheral = uses.length - core;
        result.push({
          node,
          score: core * SCG_EDGE_WEIGHT.core + peripheral * SCG_EDGE_WEIGHT.peripheral,
          core,
          peripheral,
          papers: new Set(uses.map((edge) => edge.paperId)).size,
        });
      }
      return result
        .sort((a, b) => b.score - a.score || b.papers - a.papers || a.node.id.localeCompare(b.node.id))
        .slice(0, limit);
    },
    typeCounts() {
      const counts = new Map<ScgContributionType, number>();
      for (const node of contributions())
        for (const type of new Set(node.types)) counts.set(type, (counts.get(type) ?? 0) + 1);
      return counts;
    },
  };
}

export const SCG_CHAIN_LAYOUT = { columnWidth: 180, rowHeight: 56, nodeWidth: 160, nodeHeight: 40, pad: 16 };
/** Most nodes drawn in the chain graph; the text list below it always has all of them. */
export const SCG_CHAIN_MAX_NODES = 40;

export type ChainLayout = {
  width: number;
  height: number;
  /** Column captions: years, or steps from the selected contribution. */
  columns: { x: number; label: string }[];
  nodes: { node: RoadmapNode; x: number; y: number; selected: boolean }[];
  edges: { edge: RoadmapEdge; x1: number; y1: number; x2: number; y2: number }[];
  /** Nodes left out over `SCG_CHAIN_MAX_NODES`. */
  hidden: number;
  byYear: boolean;
};

/**
 * Layered layout of a selected contribution with its ancestors and descendants. Columns are years when every
 * node has one; otherwise steps from the selection (ancestors left, descendants right).
 */
export function layoutScgChain(
  selected: RoadmapNode,
  ancestors: RoadmapChain,
  descendants: RoadmapChain,
): ChainLayout {
  const { columnWidth, rowHeight, nodeWidth, nodeHeight, pad } = SCG_CHAIN_LAYOUT;
  const step = new Map<string, number>([[selected.id, 0]]);
  for (const item of ancestors.nodes) step.set(item.node.id, -item.depth);
  for (const item of descendants.nodes) if (!step.has(item.node.id)) step.set(item.node.id, item.depth);
  const all = [
    selected,
    ...[...ancestors.nodes, ...descendants.nodes]
      .map((item) => item.node)
      .filter(
        (node, index, list) =>
          list.findIndex((other) => other.id === node.id) === index && node.id !== selected.id,
      ),
  ];
  const shown = all.slice(0, SCG_CHAIN_MAX_NODES);
  const byYear = shown.every((node) => node.year !== null);
  const columnOf = (node: RoadmapNode) => (byYear ? (node.year ?? 0) : (step.get(node.id) ?? 0));
  const keys = [...new Set(shown.map(columnOf))].sort((a, b) => a - b);
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  const placed = shown.map((node) => {
    const column = keys.indexOf(columnOf(node));
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    const at = { x: pad + column * columnWidth, y: pad + 20 + row * rowHeight };
    positions.set(node.id, at);
    return { node, ...at, selected: node.id === selected.id };
  });
  const seen = new Set<string>();
  const edges = [...ancestors.edges, ...descendants.edges].flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to || seen.has(edge.id)) return [];
    seen.add(edge.id);
    // Drawn from what is built on (to) to what builds on it (from), so arrows mostly read left to right.
    const mid = nodeHeight / 2;
    if (to.x === from.x) {
      // Same column (same paper or year): between the facing top and bottom sides.
      const down = to.y < from.y;
      const x = to.x + nodeWidth / 2;
      return [
        { edge, x1: x, y1: down ? to.y + nodeHeight : to.y, x2: x, y2: down ? from.y : from.y + nodeHeight },
      ];
    }
    const right = to.x < from.x;
    return [
      {
        edge,
        x1: right ? to.x + nodeWidth : to.x,
        y1: to.y + mid,
        x2: right ? from.x : from.x + nodeWidth,
        y2: from.y + mid,
      },
    ];
  });
  const tallest = Math.max(1, ...rows.values());
  return {
    width: pad * 2 + (keys.length - 1) * columnWidth + nodeWidth,
    height: pad * 2 + 20 + (tallest - 1) * rowHeight + nodeHeight,
    columns: keys.map((key, index) => ({
      x: pad + index * columnWidth,
      label: byYear ? String(key) : key === 0 ? 'Đang chọn' : key < 0 ? `Nền ${-key}` : `Kế thừa ${key}`,
    })),
    nodes: placed,
    edges,
    hidden: all.length - shown.length,
    byYear,
  };
}
