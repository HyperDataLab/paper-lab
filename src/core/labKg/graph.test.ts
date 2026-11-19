import { describe, expect, it } from 'vitest';
import { toJsonLd, toTurtle } from '../openkg/exportRdf';
import { KG_GRAPH_LAYERS, kgGraphCentre, type KgGraph } from '../schemas/labKg';
import { assembleKgGraph, kgFrontier, kgTrendTable, type KgLink, type KgNodeInfo } from './graph';
import { labKgGraphToPaperKg } from './graphKg';

const paper = (id: string): KgNodeInfo => ({ id, kind: 'paper', label: `Paper ${id}` });
const keyword = (id: string): KgNodeInfo => ({ id: `keywords/${id}`, kind: 'keyword', label: id });
const link = (
  via: string,
  node: KgNodeInfo,
  weight: number,
  type: KgLink['edge']['type'] = 'has_keyword',
): KgLink => ({
  via,
  node,
  edge: { source: via, target: node.id, type, weight },
});
const all = new Set(KG_GRAPH_LAYERS);

describe('L4 lab KG neighbourhood ranking', () => {
  it('L4 puts the centre first and ranks neighbours by weight, then kind and ID', () => {
    const graph = assembleKgGraph({
      centre: paper('W1'),
      hops: [
        [
          link('W1', keyword('b'), 0.5),
          link('W1', keyword('a'), 0.5),
          link('W1', paper('W2'), 0.5, 'cites'),
          link('W1', keyword('c'), 0.9),
        ],
      ],
      layers: all,
      limit: 10,
    });
    expect(graph.nodes.map(({ id }) => id)).toEqual(['W1', 'keywords/c', 'W2', 'keywords/a', 'keywords/b']);
    expect(graph.edges[0]).toMatchObject({ target: 'keywords/c', weight: 0.9 });
  });

  it('L4 caps the nodes, flags truncation and drops edges to cut nodes', () => {
    const graph = assembleKgGraph({
      centre: paper('W1'),
      hops: [[link('W1', keyword('a'), 0.9), link('W1', keyword('b'), 0.2)]],
      layers: all,
      limit: 2,
    });
    expect(graph.nodes.map(({ id }) => id)).toEqual(['W1', 'keywords/a']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.truncated).toBe(true);
  });

  it('L4 decays second-hop weights and keeps the first-hop depth of a node seen twice', () => {
    const graph = assembleKgGraph({
      centre: paper('W1'),
      hops: [
        [link('W1', keyword('a'), 0.8), link('W1', paper('W2'), 0.6, 'cites')],
        [link('keywords/a', paper('W3'), 0.5), link('keywords/a', paper('W2'), 1)],
      ],
      layers: all,
      limit: 10,
    });
    expect(graph.nodes.find(({ id }) => id === 'W3')).toMatchObject({ depth: 2, weight: 0.2 });
    expect(graph.nodes.find(({ id }) => id === 'W2')).toMatchObject({ depth: 1, weight: 0.6 });
    expect(graph.edges.some(({ source, target }) => source === 'keywords/a' && target === 'W2')).toBe(true);
  });

  it('L4 leaves out nodes of disabled layers but keeps the centre', () => {
    const graph = assembleKgGraph({
      centre: keyword('x'),
      hops: [[link('keywords/x', paper('W1'), 0.9), link('keywords/x', keyword('y'), 0.4, 'cooccur')]],
      layers: new Set(['keywords'] as const),
      limit: 10,
    });
    expect(graph.nodes.map(({ id }) => id)).toEqual(['keywords/x', 'keywords/y']);
  });

  it('L4 expands only the strongest first-hop nodes and never institutions', () => {
    const nodes = [
      { ...paper('W1'), weight: 1, depth: 0 as const },
      { id: 'I1', kind: 'institution' as const, label: 'I', weight: 1, depth: 1 as const },
      { ...keyword('a'), weight: 0.3, depth: 1 as const },
      { ...paper('W2'), weight: 0.9, depth: 1 as const },
    ];
    expect(kgFrontier(nodes, 1).map(({ id }) => id)).toEqual(['W2']);
  });

  it('L4 parses graph centres', () => {
    expect(kgGraphCentre('https://openalex.org/w12')).toEqual({ id: 'W12', kind: 'paper' });
    expect(kgGraphCentre('keywords/graph-theory')).toEqual({ id: 'keywords/graph-theory', kind: 'keyword' });
    expect(kgGraphCentre('topics/T1')).toEqual({ id: 'topics/T1', kind: 'topic' });
    expect(kgGraphCentre('A5')).toEqual({ id: 'A5', kind: 'author' });
    expect(kgGraphCentre('10.1000/X')).toEqual({ id: '10.1000/x', kind: 'paper' });
    expect(kgGraphCentre('not an id')).toBeNull();
  });
});

describe('L4 keyword trend table', () => {
  it('L4 fills a contiguous year axis', () => {
    const table = kgTrendTable(
      [{ id: 'keywords/a', text: 'a', total: 3 }],
      [
        { keywordId: 'keywords/a', year: 2021, count: 1 },
        { keywordId: 'keywords/a', year: 2023, count: 2 },
      ],
    );
    expect(table).toEqual({
      years: [2021, 2022, 2023],
      keywords: [{ id: 'keywords/a', text: 'a', total: 3, counts: [1, 0, 2] }],
    });
  });
});

describe('L4 lab KG export', () => {
  const graph: KgGraph = {
    centre: 'W1',
    depth: 1,
    layers: [...KG_GRAPH_LAYERS],
    nodes: [
      { id: 'W1', kind: 'paper', label: 'Centre', weight: 1, depth: 0, doi: '10.1000/a', year: 2020 },
      { id: 'keywords/graph-theory', kind: 'keyword', label: 'graph theory', weight: 0.9, depth: 1 },
      { id: 'topics/T1', kind: 'topic', label: 'Topic', weight: 0.5, depth: 1 },
      { id: 'W2', kind: 'paper', label: 'Built on', weight: 1, depth: 1 },
    ],
    edges: [
      { source: 'W1', target: 'keywords/graph-theory', type: 'has_keyword', weight: 0.9 },
      { source: 'W1', target: 'topics/T1', type: 'has_topic', weight: 0.5 },
      { source: 'W1', target: 'W2', type: 'builds_on', weight: 1, review: 'accepted' },
    ],
    truncated: false,
    outside: [],
  };

  it('L4 maps nodes to OpenKG IRIs and predicates', () => {
    const kg = labKgGraphToPaperKg(graph);
    expect(kg.nodes.map(({ id }) => id)).toEqual([
      'https://hyperdatalab-paragraph-lab.web.app/kg/work/W1',
      'https://hyperdatalab-paragraph-lab.web.app/kg/keyword/graph-theory',
      'https://hyperdatalab-paragraph-lab.web.app/kg/discipline/topics/T1',
      'https://hyperdatalab-paragraph-lab.web.app/kg/work/W2',
    ]);
    expect(kg.edges.map(({ p, provenance }) => `${p}:${provenance}`)).toEqual([
      'hasKeyword:openalex',
      'inTopic:openalex',
      'buildsOn:accepted',
    ]);
  });

  it('L4 exports Turtle with IRIs only and JSON-LD that parses', () => {
    const kg = labKgGraphToPaperKg(graph);
    const turtle = toTurtle(kg);
    expect(turtle).toContain(
      '<https://hyperdatalab-paragraph-lab.web.app/kg/work/W1> a schema:ScholarlyArticle .',
    );
    expect(turtle).not.toMatch(/^W1 /mu);
    expect(turtle).not.toContain(' keywords/');
    const jsonLd = JSON.parse(toJsonLd(kg)) as { '@graph': { '@id': string }[] };
    expect(jsonLd['@graph'].some((entity) => entity['@id'].endsWith('/kg/keyword/graph-theory'))).toBe(true);
  });
});
