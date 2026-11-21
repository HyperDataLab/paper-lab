import { aggregateKeywords } from '../corpusKeywords';
import { normalizeDoi } from '../library/doi';
import { buildPaperModel } from '../paperModel';
import { buildScgRoadmap, type RoadmapMember } from '../scg/roadmap';
import type { LibraryItem, PaperKeyword } from '../schemas';
import type { CorpusKeyword } from '../schemas/corpusKeywords';
import { buildLookupKg, buildPaperKg } from './build';
import { corpusMerge, type CorpusKgEdge } from './corpusMerge';
import { keywordSalience } from './openAlex';
import {
  kgIri,
  type KgAttribute,
  type KgEdge,
  type KgLayer,
  type KgNode,
  type KgNodeType,
  type PaperKgInput,
} from './types';

export type CorpusKgMember = RoadmapMember;
export type CorpusKgMetadata = { library?: LibraryItem; keywords?: PaperKeyword[] };
export type CorpusKgInput = {
  papers: PaperKgInput[];
  members: readonly CorpusKgMember[];
  memberMetadata?: ReadonlyMap<string, CorpusKgMetadata>;
};

export interface CorpusKg {
  nodes: KgNode[];
  edges: CorpusKgEdge[];
  coverage: { members: number; withModel: number; withLookup: number; withScg: number };
  layerCounts: Record<KgLayer, { nodes: number; edges: number }>;
  nodeCounts: Partial<Record<KgNodeType, number>>;
  trend: { years: number[]; keywords: CorpusKeyword[] };
}

function identifiable(value: unknown, attribute: 'doi' | 'openalexId') {
  if (typeof value !== 'string') return null;
  if (attribute === 'doi') return normalizeDoi(value);
  const id = value
    .trim()
    .replace(/^https?:\/\/openalex\.org\//iu, '')
    .toUpperCase();
  return /^W\d+$/u.test(id) ? id : null;
}

const keywordId = (id: string) => kgIri('keyword', id.slice('keywords/'.length));
const openAlexAvailable = (item?: LibraryItem) =>
  Boolean(
    item?.openalex_id ||
    item?.keywords !== undefined ||
    item?.authorships?.length ||
    item?.referenced_works?.length ||
    item?.openalex_source_id ||
    item?.taxonomy?.topicId,
  );

export function buildCorpusKg({ papers, members, memberMetadata }: CorpusKgInput): CorpusKg {
  const graph = corpusMerge();
  const inputs = new Map(papers.map((input) => [input.paper.id, input]));
  const identity = new Map<string, string | null>();
  const paperById = new Map<string, string>();
  const sentenceKeys = new Map<string, Set<string>>();
  const citations: { edge: KgEdge; paper: string; source: string }[] = [];
  const keywordPapers = [];
  const runs = [];
  const coverage = { members: members.length, withModel: 0, withLookup: 0, withScg: 0 };

  function index(value: unknown, attribute: 'doi' | 'openalexId', paper: string) {
    const id = identifiable(value, attribute);
    if (!id) return;
    const previous = identity.get(id);
    identity.set(id, previous === undefined || previous === paper ? paper : null);
  }

  for (const member of [...members].sort((a, b) => a.memberId.localeCompare(b.memberId))) {
    const { identifiers, stratum } = member;
    const local = [...new Set(identifiers.paperIds)].flatMap((id) => {
      const input = inputs.get(id);
      return input ? [input] : [];
    });
    const first = local[0];
    const metadata = memberMetadata?.get(member.memberId);
    const library = metadata?.library ?? local.find((input) => input.library)?.library;
    const paper = first ? kgIri('paper', first.paper.id) : kgIri('member', member.memberId);
    const keywords = new Map<string, PaperKeyword>();
    const article: KgNode = {
      id: paper,
      type: 'Paper',
      layer: 'evidential',
      label: first?.paper.title || member.title || library?.title || identifiers.doi || 'Bài chưa có title',
      attrs: {},
    };

    function recordIdentity(values: Partial<Record<KgAttribute, unknown>>) {
      for (const attribute of ['doi', 'openalexId'] as const) {
        index(values[attribute], attribute, paper);
        const id = identifiable(values[attribute], attribute);
        if (id) article.attrs[attribute] ??= id;
      }
    }
    recordIdentity({ doi: identifiers.doi, openalexId: identifiers.openalexId });
    recordIdentity({ doi: library?.doi, openalexId: library?.openalex_id });
    for (const doi of identifiers.doiAliases ?? []) index(doi, 'doi', paper);
    for (const id of identifiers.openalexIdAliases ?? []) index(id, 'openalexId', paper);
    let year = stratum.year ?? library?.year ?? null;

    function merge(kg: ReturnType<typeof buildPaperKg>, source: string, terms: PaperKeyword[]) {
      for (const term of terms) {
        const current = keywords.get(term.id);
        if (!current || term.score > current.score) keywords.set(term.id, term);
      }
      for (const node of kg.nodes) {
        if (node.type === 'Paper') {
          recordIdentity(node.attrs);
          if (typeof node.attrs.year === 'number') year ??= node.attrs.year;
        } else graph.node(node);
      }
      const authors = new Set<string>();
      for (const link of kg.edges) {
        const edge = { ...link, s: link.s === source ? paper : link.s };
        if (edge.p === 'cites') citations.push({ edge, paper, source });
        else if (edge.p !== 'hasKeyword') graph.edge(edge, paper, source);
        if (edge.p === 'authoredBy') authors.add(edge.o);
      }
      const ordered = [...authors].sort();
      ordered.forEach((s, i) => {
        for (const o of ordered.slice(i + 1))
          graph.edge({ s, o, p: 'coAuthor', layer: 'expertise', provenance: 'openalex' }, paper);
      });
    }

    const scgRuns = local.flatMap(({ paper, scgRun }) => (scgRun?.paperId === paper.id ? [scgRun] : []));
    runs.push(...scgRuns);
    coverage.withModel += Number(local.length > 0);
    coverage.withLookup += Number(
      openAlexAvailable(library) ||
        metadata?.keywords !== undefined ||
        local.some((input) => openAlexAvailable(input.library)),
    );
    coverage.withScg += Number(scgRuns.length > 0);

    for (const input of local) {
      const model =
        input.model ??
        buildPaperModel({ paper: input.paper, metadata: null, now: new Date(input.paper.updatedAt) });
      const source = kgIri('paper', input.paper.id);
      paperById.set(input.paper.id, paper);
      if (input.scgRun) sentenceKeys.set(input.paper.id, new Set(model.sentences.map(({ key }) => key)));
      recordIdentity({ doi: model.document.metadata.doi, openalexId: input.library?.openalex_id });
      merge(buildPaperKg({ ...input, model }), source, input.library?.keywords ?? []);
    }
    const backfilled = library?.keywords === undefined ? metadata?.keywords : undefined;
    if ((library && !local.some((input) => input.library?.id === library.id)) || backfilled?.length)
      merge(buildLookupKg(article, library, backfilled), paper, library?.keywords ?? backfilled ?? []);

    if (year !== null) article.attrs.year = year;
    graph.node(article);
    keywordPapers.push({ memberId: paper, year, keywords: [...keywords.values()] });
    for (const { id, score } of keywords.values())
      graph.edge(
        {
          s: paper,
          o: keywordId(id),
          p: 'hasKeyword',
          layer: 'conceptual',
          provenance: 'openalex',
          keywordScore: score,
        },
        paper,
      );
  }

  const redirected = new Set<string>();
  for (const { edge, paper, source } of citations) {
    const work = graph.nodes.get(edge.o);
    const doi = identifiable(work?.attrs.doi, 'doi');
    const id = identifiable(work?.attrs.openalexId, 'openalexId');
    const target = (doi && identity.get(doi)) || (id && identity.get(id));
    if (target) redirected.add(edge.o);
    graph.edge({ ...edge, o: target || edge.o }, paper, source);
  }

  const roadmap = buildScgRoadmap(runs, [...members]);
  for (const edge of roadmap.edges) {
    const from = roadmap.nodes.get(edge.from);
    const to = roadmap.nodes.get(edge.to);
    const paper = paperById.get(edge.paperId);
    if (
      from?.kind !== 'contribution' ||
      to?.kind !== 'contribution' ||
      from.memberId === to.memberId ||
      !paper
    )
      continue;
    graph.edge(
      {
        s: kgIri('contribution', edge.from),
        o: kgIri('contribution', edge.to),
        p: 'buildsOn',
        layer: 'conceptual',
        provenance: edge.review === 'accepted' ? 'accepted' : 'llm_candidate',
        evidence: edge.sourceSentenceKeys.filter((key) => sentenceKeys.get(edge.paperId)?.has(key)),
      },
      paper,
      kgIri('paper', edge.paperId),
    );
  }

  const aggregate = aggregateKeywords(keywordPapers, Number.POSITIVE_INFINITY);
  const keywordSupport = new Map<string, Set<string>>();
  for (const keyword of aggregate.keywords) {
    keywordSupport.set(keyword.id, new Set(keyword.paperIds));
    const node = graph.nodes.get(keywordId(keyword.id));
    if (node)
      graph.nodes.set(node.id, {
        ...node,
        attrs: { ...node.attrs, score: keyword.meanScore, salience: keywordSalience(keyword.meanScore) },
      });
  }
  for (const { a, b, strength } of aggregate.pairs) {
    const other = keywordSupport.get(b);
    for (const paper of keywordSupport.get(a) ?? []) {
      if (other?.has(paper))
        graph.edge(
          {
            s: keywordId(a),
            o: keywordId(b),
            p: 'relatedKeyword',
            layer: 'conceptual',
            provenance: 'openalex',
            weight: strength,
          },
          paper,
        );
    }
  }

  const edges = graph.relationships();
  const linked = new Set(edges.flatMap(({ s, o }) => [s, o]));
  const nodes = [...graph.nodes.values()].filter(({ id }) => !redirected.has(id) || linked.has(id));
  const layerCounts: CorpusKg['layerCounts'] = {
    evidential: { nodes: 0, edges: 0 },
    conceptual: { nodes: 0, edges: 0 },
    disciplinary: { nodes: 0, edges: 0 },
    expertise: { nodes: 0, edges: 0 },
    normative: { nodes: 0, edges: 0 },
  };
  const nodeCounts: CorpusKg['nodeCounts'] = {};
  for (const { type, layer } of nodes) {
    layerCounts[layer].nodes++;
    nodeCounts[type] = (nodeCounts[type] ?? 0) + 1;
  }
  for (const { layer } of edges) layerCounts[layer].edges++;
  const years = [...new Set(keywordPapers.flatMap(({ year }) => (year === null ? [] : [year])))].sort(
    (a, b) => a - b,
  );
  return {
    nodes,
    edges,
    coverage,
    layerCounts,
    nodeCounts,
    trend: { years, keywords: aggregate.keywords.slice(0, 15) },
  };
}
