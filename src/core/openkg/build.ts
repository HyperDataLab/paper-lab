import { normalizeDoi } from '../library/doi';
import { buildPaperModel } from '../paperModel';
import { addKeywords, addOpenAlex } from './openAlex';
import { addArguments } from './arguments';
import { citationEvidence } from './citationEvidence';
import { addScg } from './scg';
import type { LibraryItem, PaperKeyword } from '../schemas';
import { kgIri, type KgEdge, type KgNode, type PaperKgInput } from './types';

export interface KgBuilder {
  node(node: Omit<KgNode, 'attrs'> & { attrs?: KgNode['attrs'] }): string;
  edge(edge: KgEdge): void;
}

function paperGraph() {
  const nodes = new Map<string, KgNode>();
  const edges = new Map<string, KgEdge>();
  const graph: KgBuilder = {
    node({ attrs = {}, ...node }) {
      if (!nodes.has(node.id)) nodes.set(node.id, { ...node, attrs });
      return node.id;
    },
    edge({ evidence: incoming, ...edge }) {
      const key = JSON.stringify([edge.s, edge.p, edge.o, edge.layer, edge.provenance]);
      const evidence = [...new Set([...(edges.get(key)?.evidence ?? []), ...(incoming ?? [])])];
      edges.set(key, { ...edge, ...(evidence.length ? { evidence } : {}) });
    },
  };
  return { graph, finish: () => ({ nodes: [...nodes.values()], edges: [...edges.values()] }) };
}

export function buildLookupKg(article: KgNode, library?: LibraryItem, keywords?: PaperKeyword[]) {
  const { graph, finish } = paperGraph();
  graph.node(article);
  if (library) addOpenAlex(graph, article.id, library);
  if (keywords) addKeywords(graph, article.id, keywords);
  return finish();
}

export function buildPaperKg({ paper, library, scgRun, argumentRun, model }: PaperKgInput) {
  const { graph, finish } = paperGraph();
  const current = model ?? buildPaperModel({ paper, metadata: null, now: new Date(paper.updatedAt) });
  const metadata = current.document.metadata;
  const doi = normalizeDoi(library?.doi ?? metadata.doi ?? scgRun?.doi ?? '');
  const year = library?.year ?? metadata.year;
  const article = graph.node({
    id: kgIri('paper', paper.id),
    type: 'Paper',
    label: paper.title,
    layer: 'evidential',
    attrs: {
      ...(doi ? { doi } : {}),
      ...(year !== null ? { year } : {}),
      ...(library?.openalex_id ? { openalexId: library.openalex_id } : {}),
    },
  });
  const citedIn = citationEvidence(paper, current);
  const references = new Map(
    current.document.references.map((ref) => {
      const doi = normalizeDoi(ref.doi ?? '');
      const id = graph.node({
        id: doi ? kgIri('work', doi) : kgIri('work', paper.id, ref.id),
        type: 'Work',
        label: ref.text,
        layer: 'evidential',
        attrs: { ...(doi ? { doi } : {}), ...(ref.year !== null ? { year: ref.year } : {}) },
      });
      graph.edge({
        s: article,
        p: 'cites',
        o: id,
        layer: 'evidential',
        provenance: 'paper_text',
        evidence: [...(citedIn.get(ref.id) ?? [])],
      });
      return [ref.id, id] as const;
    }),
  );
  if (library) addOpenAlex(graph, article, library);
  if (scgRun?.paperId === paper.id)
    addScg(graph, article, scgRun, references, new Set(current.sentences.map(({ key }) => key)));
  if (argumentRun) addArguments(graph, article, paper, argumentRun, current.sentences);
  return finish();
}
