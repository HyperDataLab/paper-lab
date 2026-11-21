import { describe, expect, it } from 'vitest';
import { corpusFixture, term } from './corpusFixtures';
import { buildCorpusKg, kgIri, toJsonLd, toSciAtlasCorpusReport, toTurtle } from './index';

const title = 'Synthetic corpus';
const input = corpusFixture();
const graph = buildCorpusKg(input);
const alpha = kgIri('paper', 'alpha');
const beta = kgIri('paper', 'beta');
const gamma = kgIri('member', 'c');

describe('K3 corpus OpenKG', () => {
  it('merges shared resources by IRI and measures coverage, layers and node counts by distinct member', () => {
    expect(graph.coverage).toEqual({ members: 3, withModel: 2, withLookup: 3, withScg: 2 });
    expect(graph.nodeCounts).toMatchObject({
      Paper: 3,
      Work: 1,
      Source: 1,
      Domain: 1,
      Topic: 1,
      Keyword: 2,
      Author: 2,
      Institution: 1,
      Contribution: 2,
    });
    const ids = new Set(graph.nodes.map(({ id }) => id));
    expect(ids.size).toBe(graph.nodes.length);
    expect(graph.edges.every(({ s, o }) => ids.has(s) && ids.has(o))).toBe(true);
    expect(ids).toContain(kgIri('work', 'W900'));
    expect(ids).not.toContain(kgIri('paper', 'beta-v2'));
    expect(graph.nodes.find(({ id }) => id === kgIri('contribution', 'alpha.c0'))?.label).toBe(
      'Alpha dataset',
    );
    expect(graph.layerCounts.disciplinary).toEqual({ nodes: 2, edges: 3 });
    expect(graph.edges.find(({ p }) => p === 'broader')).toMatchObject({
      supportCount: 2,
      provenance: 'openalex',
    });
    expect(graph.edges.find(({ p }) => p === 'affiliatedWith')).toMatchObject({ supportCount: 2 });
    expect(buildCorpusKg({ ...input, papers: [...input.papers].reverse() })).toEqual(graph);
  });

  it('resolves corpus citations by DOI and OpenAlex aliases and preserves each origin without double-counting a member', () => {
    const citation = graph.edges.find(({ s, p, o }) => s === beta && p === 'cites' && o === alpha);
    expect(citation).toMatchObject({
      provenance: 'paper_text',
      supportCount: 1,
      support: expect.arrayContaining([
        expect.objectContaining({ paper: beta, provenance: 'openalex' }),
        expect.objectContaining({ paper: beta, provenance: 'paper_text', evidence: [expect.any(String)] }),
        expect.objectContaining({
          paper: beta,
          sourcePaper: kgIri('paper', 'beta-v2'),
          provenance: 'paper_text',
          evidence: [expect.any(String)],
        }),
      ]),
    });
    expect(citation?.support).toHaveLength(3);
    expect(graph.edges.find(({ s, p, o }) => s === beta && p === 'cites' && o === gamma)).toMatchObject({
      supportCount: 1,
      provenance: 'openalex',
    });
  });

  it('uses roadmap cross-paper links and adds co-authorship, Jaccard support and yearly keyword counts', () => {
    const dependency = graph.edges.find(
      ({ s, p, o }) =>
        s === kgIri('contribution', 'beta.c0') && p === 'buildsOn' && o === kgIri('contribution', 'alpha.c0'),
    );
    expect(dependency).toMatchObject({
      provenance: 'accepted',
      supportCount: 1,
      support: [
        { paper: beta, provenance: 'accepted', evidence: [expect.any(String)] },
        { paper: beta, provenance: 'llm_candidate', evidence: [expect.any(String)] },
      ],
    });
    expect(dependency?.evidence).not.toContain('missing#1');
    expect(graph.edges.find(({ p }) => p === 'coAuthor')).toMatchObject({
      s: kgIri('author', 'A1'),
      o: kgIri('author', 'A2'),
      supportCount: 2,
      support: [
        { paper: alpha, provenance: 'openalex' },
        { paper: beta, provenance: 'openalex' },
      ],
    });
    expect(graph.edges.find(({ p }) => p === 'relatedKeyword')).toMatchObject({
      s: kgIri('keyword', 'common'),
      o: kgIri('keyword', 'paired'),
      weight: 2 / 3,
      supportCount: 2,
      support: [{ paper: alpha }, { paper: beta }],
    });
    expect(graph.trend).toMatchObject({
      years: [2021, 2022],
      keywords: [
        { id: 'keywords/common', paperCount: 3, years: { 2021: 1, 2022: 1 } },
        { id: 'keywords/paired', paperCount: 2, years: { 2021: 1, 2022: 1 } },
      ],
    });
    expect(
      graph.edges.find(({ s, p, o }) => s === alpha && p === 'hasKeyword' && o === kgIri('keyword', 'common'))
        ?.keywordScore,
    ).toBe(0.8);
  });

  it('limits trend to the 15 most frequent keywords without dropping graph relationships', () => {
    const member = input.members[0];
    if (!member) throw new Error('Missing synthetic member');
    const keywords = Array.from({ length: 17 }, (_, index) =>
      term(`term-${String(index).padStart(2, '0')}`, 0.5),
    );
    const result = buildCorpusKg({
      papers: [],
      members: [member],
      memberMetadata: new Map([[member.memberId, { keywords }]]),
    });
    expect(result.trend.keywords).toHaveLength(15);
    expect(result.trend.keywords.at(-1)?.id).toBe('keywords/term-14');
    expect(result.nodeCounts.Keyword).toBe(17);
    expect(result.edges.filter(({ p }) => p === 'relatedKeyword')).toHaveLength(136);
  });

  it('exports the complete corpus with one prefix block, stable resource IRIs and RDF support metadata', () => {
    const turtle = toTurtle(graph);
    expect(turtle.match(/^@prefix \w+:/gmu)).toEqual([
      '@prefix schema:',
      '@prefix pl:',
      '@prefix rdf:',
      '@prefix xsd:',
    ]);
    expect(turtle).toContain(`<${beta}> schema:citation <${alpha}> .`);
    expect(turtle).toContain('pl:supportCount 2 .');
    expect(turtle).toContain('pl:weight "0.6666666666666666"^^xsd:double .');
    const data: unknown = JSON.parse(toJsonLd(graph));
    expect(data).toMatchObject({
      '@context': { schema: 'https://schema.org/' },
      '@graph': expect.arrayContaining([
        expect.objectContaining({
          '@id': beta,
          'schema:citation': expect.arrayContaining([{ '@id': alpha }, { '@id': gamma }]),
        }),
        expect.objectContaining({
          '@type': 'rdf:Statement',
          'pl:supportCount': [2],
          'rdf:predicate': [{ '@id': 'pl:coAuthor' }],
        }),
        expect.objectContaining({
          '@type': 'pl:Support',
          'pl:supportingPaper': [{ '@id': beta }],
          'pl:evidencePaper': [{ '@id': kgIri('paper', 'beta-v2') }],
        }),
      ]),
    });
    expect(toTurtle(buildCorpusKg(input))).toBe(turtle);
  });

  it('reports coverage, discipline mix, salience and trend, contributions, expertise and both citation groups', () => {
    const report = toSciAtlasCorpusReport(graph, title);
    expect(report.match(/^## .+$/gmu)).toEqual([
      '## Overview',
      '## Disciplines mix',
      '## Top keywords by salience and trend',
      '## Most built-upon contributions',
      '## Key authors and institutions',
      '## Most-cited works inside and outside the corpus',
    ]);
    expect(report).toContain(title);
    expect(report).toContain('Synthetic domain (2 papers)');
    expect(report).toContain('2021: 1, 2022: 1');
    expect(report).toContain('Alpha dataset (1 dependent');
    expect(report).toContain('Example Institute (2 papers)');
    expect(report).toMatch(/### Inside the corpus\n\n- Alpha study \(1 paper\)/u);
    expect(report).toMatch(/### Outside the corpus\n\n- W900 \(2 papers\)/u);
  });
});
