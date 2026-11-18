import { describe, expect, it } from 'vitest';
import {
  corpusSciAtlasAnchors,
  normalizeSciAtlasPapers,
  paperSciAtlasAnchors,
  readSciAtlasEnvelope,
  SciAtlasSearchRequestSchema,
  toSciAtlasPayload,
  type CorpusKg,
  type PaperKg,
} from './index';

const payloadOf = (body: unknown) => toSciAtlasPayload(SciAtlasSearchRequestSchema.parse(body));

describe('K4 SciAtlas payload', () => {
  it('K4 maps levels to keyword scores and title confidences', () => {
    const payload = payloadOf({
      keywords: [
        { text: 'alpha', level: 'high' },
        { text: 'beta', level: 'middle' },
        { text: 'gamma', level: 'low' },
      ],
      titles: [
        { title: 'Synthetic title one', level: 'high' },
        { title: 'Synthetic title two', level: 'middle' },
        { title: 'Synthetic title three', level: 'low' },
      ],
      references: ['Synthetic reference'],
    });
    expect(payload.plan).toEqual({
      query_text: 'Synthetic title one; Synthetic title two; Synthetic title three; alpha; beta; gamma',
      source_type: 'idea_text',
      source_title: 'Synthetic title one',
      keywords: [
        { text: 'alpha', score: 9 },
        { text: 'beta', score: 7 },
        { text: 'gamma', score: 4 },
      ],
      titles: [
        { title: 'Synthetic title one', confidence: 0.95 },
        { title: 'Synthetic title two', confidence: 0.85 },
        { title: 'Synthetic title three', confidence: 0.65 },
      ],
      reference_titles: ['Synthetic reference'],
    });
    expect(payload.options).toEqual({ top_k: 10, retrieval_mode: 'hybrid' });
  });

  it('K4 needs at least one keyword or title', () => {
    expect(SciAtlasSearchRequestSchema.safeParse({ query: 'x', references: ['y'] }).success).toBe(false);
    expect(SciAtlasSearchRequestSchema.safeParse({ keywords: [{ text: 'x', level: 'high' }] }).success).toBe(
      true,
    );
    expect(
      SciAtlasSearchRequestSchema.safeParse({ titles: [{ title: 'Some title', level: 'low' }] }).success,
    ).toBe(true);
  });

  it('K4 sends the date range, ranking and a top-k capped at 20', () => {
    const payload = payloadOf({
      query: 'own query',
      keywords: [{ text: 'alpha', level: 'high' }],
      after: '2018-01-01',
      before: '2028-12-31',
      topK: 99,
      mode: 'semantic',
      ranking: 'discovery',
    });
    expect(payload.plan.query_text).toBe('own query');
    expect(payload.plan.source_title).toBeNull();
    expect(payload.options).toEqual({
      top_k: 20,
      retrieval_mode: 'semantic',
      after: '2018-01-01',
      before: '2028-12-31',
      retrieval_bias: { ranking_profile: 'discovery' },
    });
    expect(
      SciAtlasSearchRequestSchema.safeParse({ keywords: [{ text: 'a', level: 'high' }], after: '2018' })
        .success,
    ).toBe(false);
  });
});

describe('K4 SciAtlas normaliser', () => {
  it('K4 reads different key names in nested data without listing authors or venues as papers', () => {
    const papers = normalizeSciAtlasPapers({
      query: { keywords: [{ name: 'echoed keyword', score: 9 }] },
      groups: [
        {
          label: 'cluster',
          items: [
            {
              title: 'First synthetic paper',
              year: '2021',
              rank_score: 0.9,
              citation_count: 4,
              venue: { display_name: 'Synthetic Venue' },
              authors: [{ name: 'A. Author', id: 'A1' }, 'B. Author'],
              id: 'https://openalex.org/W42',
              abstract_text: 'Synthetic abstract.',
            },
          ],
        },
        {
          paper: {
            work_title: 'Second synthetic paper',
            pub_year: 2019,
            final_score: '0.5',
            cited_by_count: 1,
            conference: 'Synthetic Conf',
            paper_id: 'p-2',
            doi: 'doi:10.1000/XYZ',
          },
        },
        { display_name: 'Third synthetic paper', publication_year: 2020, paper_id: 'p-3' },
        { name: 'Not a paper' },
      ],
    });
    expect(papers).toEqual([
      {
        rank: 1,
        title: 'First synthetic paper',
        year: 2021,
        score: 0.9,
        citations: 4,
        venue: 'Synthetic Venue',
        authors: ['A. Author', 'B. Author'],
        id: 'https://openalex.org/W42',
        openalexId: 'W42',
        abstract: 'Synthetic abstract.',
      },
      {
        rank: 2,
        title: 'Second synthetic paper',
        year: 2019,
        score: 0.5,
        citations: 1,
        venue: 'Synthetic Conf',
        authors: [],
        id: 'p-2',
        doi: '10.1000/xyz',
      },
      {
        rank: 3,
        title: 'Third synthetic paper',
        year: 2020,
        score: null,
        citations: null,
        venue: null,
        authors: [],
        id: 'p-3',
      },
    ]);
  });

  it('K4 dedupes by DOI, OpenAlex id, id or title', () => {
    const papers = normalizeSciAtlasPapers([
      { title: 'Paper A', doi: '10.1000/a' },
      { title: 'Paper A again', doi: 'https://doi.org/10.1000/A' },
      { title: 'Paper B', openalex_id: 'W7' },
      { title: 'Paper B copy', id: 'https://openalex.org/w7' },
      { title: 'Paper C', paper_id: 'c' },
      { title: 'Paper C!', paper_id: 'c' },
      { title: 'Paper D' },
      { title: 'paper   d' },
    ]);
    expect(papers.map(({ rank, title }) => [rank, title])).toEqual([
      [1, 'Paper A'],
      [2, 'Paper B'],
      [3, 'Paper C'],
      [4, 'Paper D'],
    ]);
  });

  it('K4 treats any status other than ok as an error and keeps only a safe request id', () => {
    expect(readSciAtlasEnvelope({ status: 'error', detail: 'secret text', request_id: 'r-1' })).toEqual({
      ok: false,
      requestId: 'r-1',
    });
    expect(readSciAtlasEnvelope({ status: 'ok', request_id: 'bad id <x>', data: [] })).toEqual({
      ok: true,
      papers: [],
    });
    expect(readSciAtlasEnvelope(null)).toEqual({ ok: false });
  });
});

const paperKg: PaperKg = {
  nodes: [
    { id: 'p', type: 'Paper', label: 'Synthetic  paper title', layer: 'evidential', attrs: { year: 2020 } },
    ...[
      ['k1', 'low one', 0.2, 'low'],
      ['k2', 'high one', 0.7, 'high'],
      ['k3', 'middle one', 0.5, 'middle'],
      ['k4', 'higher one', 0.9, 'high'],
    ].map(([id, label, score, salience]) => ({
      id: String(id),
      type: 'Keyword' as const,
      label: String(label),
      layer: 'conceptual' as const,
      attrs: { score: Number(score), salience: String(salience) },
    })),
    { id: 'w1', type: 'Work', label: 'W123', layer: 'evidential', attrs: {} },
    { id: 'w2', type: 'Work', label: 'An SCG reference title', layer: 'evidential', attrs: {} },
    { id: 'pre', type: 'Prerequisite', label: 'pre', layer: 'conceptual', attrs: {} },
  ],
  edges: [
    { s: 'p', p: 'cites', o: 'w1', layer: 'evidential', provenance: 'openalex' },
    { s: 'pre', p: 'buildsOn', o: 'w2', layer: 'conceptual', provenance: 'llm_candidate' },
  ],
};

describe('K4 SciAtlas anchors', () => {
  it('K4 builds paper anchors from salient keywords, the title, reference titles and year ± 5', () => {
    expect(paperSciAtlasAnchors(paperKg, ['A GROBID reference title', 'W999', 'short'])).toEqual({
      keywords: [
        { text: 'higher one', level: 'high' },
        { text: 'high one', level: 'high' },
        { text: 'middle one', level: 'middle' },
      ],
      titles: [{ title: 'Synthetic paper title', level: 'high' }],
      references: ['A GROBID reference title', 'An SCG reference title'],
      years: { from: 2015, to: 2025 },
    });
  });

  it('K4 caps paper keywords at 8 and references at 10', () => {
    const many: PaperKg = {
      nodes: Array.from({ length: 12 }, (_, i) => ({
        id: `k${i}`,
        type: 'Keyword' as const,
        label: `keyword ${i}`,
        layer: 'conceptual' as const,
        attrs: { score: 0.9, salience: 'high' },
      })),
      edges: [],
    };
    const anchors = paperSciAtlasAnchors(
      many,
      Array.from({ length: 15 }, (_, i) => `Reference title ${i}`),
    );
    expect(anchors.keywords).toHaveLength(8);
    expect(anchors.references).toHaveLength(10);
    expect(anchors.titles).toEqual([]);
    expect(anchors.years).toBeNull();
  });

  it('K4 builds corpus anchors from the keywords on most papers, half high and half middle', () => {
    const keyword = (name: string, paperCount: number) => ({
      id: `keywords/${name}`,
      name,
      paperCount,
      share: 0,
      meanScore: 0.5,
      paperIds: [],
      years: {},
    });
    const kg = {
      trend: { years: [2019, 2021, 2024], keywords: [keyword('a', 1), keyword('b', 5), keyword('c', 3)] },
    } as unknown as CorpusKg;
    expect(corpusSciAtlasAnchors(kg)).toEqual({
      keywords: [
        { text: 'b', level: 'high' },
        { text: 'c', level: 'high' },
        { text: 'a', level: 'middle' },
      ],
      titles: [],
      references: [],
      years: { from: 2019, to: 2024 },
    });
  });
});
