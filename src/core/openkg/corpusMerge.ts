import type { KgEdge, KgNode, KgProvenance, KgSupport } from './types';

export type CorpusKgEdge = KgEdge & { supportCount: number; support: KgSupport[] };

const PROVENANCE_ORDER: Record<KgProvenance, number> = {
  llm_candidate: 0,
  openalex: 1,
  paper_text: 2,
  accepted: 3,
};

function union(a?: string[], b?: string[]) {
  return a?.length || b?.length ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined;
}

function preferredNode(existing: KgNode, incoming: KgNode) {
  const fallback = (node: KgNode) =>
    !node.label ||
    node.label === node.attrs.openalexId ||
    node.label === node.attrs.orcid ||
    node.label === node.attrs.ror;
  return (fallback(existing) && !fallback(incoming)) || (!existing.attrs.review && incoming.attrs.review)
    ? incoming
    : existing;
}

export function corpusMerge() {
  const nodes = new Map<string, KgNode>();
  const edges = new Map<string, { edge: KgEdge; papers: Set<string>; support: Map<string, KgSupport> }>();

  return {
    nodes,
    node(incoming: KgNode) {
      const existing = nodes.get(incoming.id);
      if (!existing) nodes.set(incoming.id, incoming);
      else {
        const preferred = preferredNode(existing, incoming);
        nodes.set(incoming.id, {
          ...preferred,
          attrs: { ...incoming.attrs, ...existing.attrs, ...preferred.attrs },
        });
      }
    },
    edge(incoming: KgEdge, paper: string, actualPaper = paper) {
      const key = JSON.stringify([incoming.s, incoming.p, incoming.o]);
      const entry = edges.get(key) ?? { edge: { ...incoming }, papers: new Set(), support: new Map() };
      const { edge, papers, support } = entry;
      const { provenance, evidence, keywordScore } = incoming;
      if (PROVENANCE_ORDER[provenance] > PROVENANCE_ORDER[edge.provenance]) edge.provenance = provenance;
      edge.evidence = union(edge.evidence, evidence);
      if (keywordScore !== undefined)
        edge.keywordScore = Math.max(edge.keywordScore ?? keywordScore, keywordScore);
      papers.add(paper);
      const sourcePaper = evidence?.length && actualPaper !== paper ? actualPaper : undefined;
      const origin = JSON.stringify([paper, sourcePaper, provenance]);
      support.set(origin, {
        paper,
        sourcePaper,
        provenance,
        evidence: union(support.get(origin)?.evidence, evidence),
      });
      edges.set(key, entry);
    },
    relationships(): CorpusKgEdge[] {
      return [...edges.values()].map(({ edge, papers, support }) => ({
        ...edge,
        supportCount: papers.size,
        support: [...support.values()],
      }));
    },
  };
}
