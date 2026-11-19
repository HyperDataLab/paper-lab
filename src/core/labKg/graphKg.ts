// Maps a lab KG neighbourhood onto the OpenKG graph model, so the shared graph view and the Turtle / JSON-LD
// exporters work on it unchanged. IRIs reuse the OpenKG segments: works and authors are keyed by OpenAlex ID as
// in `openkg/openAlex.ts` (which prefers an ORCID for authors and a ROR for institutions; the lab KG view has
// neither, so it uses the OpenAlex IDs), keywords and disciplines by their OpenAlex short IDs.
import {
  kgIri,
  type KgEdge,
  type KgLayer,
  type KgNode,
  type KgNodeType,
  type PaperKg,
} from '../openkg/types';
import type { KgGraph, KgGraphEdgeType, KgGraphNode, KgGraphNodeKind } from '../schemas/labKg';

const NODE_TYPE: Record<KgGraphNodeKind, KgNodeType> = {
  paper: 'Work',
  keyword: 'Keyword',
  author: 'Author',
  institution: 'Institution',
  topic: 'Topic',
  subfield: 'Subfield',
  field: 'Field',
  domain: 'Domain',
};
const NODE_LAYER: Record<KgGraphNodeKind, KgLayer> = {
  paper: 'evidential',
  keyword: 'conceptual',
  author: 'expertise',
  institution: 'expertise',
  topic: 'disciplinary',
  subfield: 'disciplinary',
  field: 'disciplinary',
  domain: 'disciplinary',
};
const EDGE: Record<KgGraphEdgeType, Pick<KgEdge, 'p' | 'layer'>> = {
  has_keyword: { p: 'hasKeyword', layer: 'conceptual' },
  cites: { p: 'cites', layer: 'evidential' },
  cooccur: { p: 'relatedKeyword', layer: 'conceptual' },
  authored: { p: 'authoredBy', layer: 'expertise' },
  affiliated: { p: 'affiliatedWith', layer: 'expertise' },
  coauthor: { p: 'coAuthor', layer: 'expertise' },
  has_topic: { p: 'inTopic', layer: 'disciplinary' },
  hierarchy: { p: 'broader', layer: 'disciplinary' },
  builds_on: { p: 'buildsOn', layer: 'conceptual' },
};

/** The OpenKG IRI of a lab KG node. */
export function labKgIri({ id, kind }: Pick<KgGraphNode, 'id' | 'kind'>) {
  if (kind === 'paper') return kgIri('work', id);
  if (kind === 'keyword') return kgIri('keyword', id.slice('keywords/'.length));
  if (kind === 'author' || kind === 'institution') return kgIri(kind, id);
  return kgIri('discipline', ...id.split('/'));
}

/** The lab KG neighbourhood as an OpenKG graph, nodes in rank order. */
export function labKgGraphToPaperKg(graph: KgGraph): PaperKg {
  const iris = new Map(graph.nodes.map((node) => [node.id, labKgIri(node)]));
  const nodes = graph.nodes.map((node): KgNode => ({
    id: labKgIri(node),
    type: NODE_TYPE[node.kind],
    label: node.label,
    layer: NODE_LAYER[node.kind],
    attrs: {
      ...(node.kind === 'paper' || node.kind === 'author' || node.kind === 'institution'
        ? { openalexId: node.id }
        : {}),
      ...(node.doi ? { doi: node.doi } : {}),
      ...(typeof node.year === 'number' ? { year: node.year } : {}),
      score: node.weight,
    },
  }));
  const edges = graph.edges.flatMap((edge): KgEdge[] => {
    const s = iris.get(edge.source);
    const o = iris.get(edge.target);
    if (!s || !o) return [];
    return [
      {
        s,
        o,
        ...EDGE[edge.type],
        provenance:
          edge.type === 'builds_on'
            ? edge.review === 'accepted'
              ? 'accepted'
              : 'llm_candidate'
            : 'openalex',
        ...(edge.type === 'has_keyword' ? { keywordScore: edge.weight } : { weight: edge.weight }),
      },
    ];
  });
  return { nodes, edges };
}
