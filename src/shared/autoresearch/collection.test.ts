import { afterEach, expect, it, vi } from 'vitest';
import { at, outputs } from '@/core/autoresearch/fixtures';
import { passStage } from '@/core/autoresearch/validation';
import { newCorpus } from '@/core/corpus';
import { addMember } from '@/core/corpus/intake';
import { newProject } from '@/core/extraction';
import { createScholarClient } from '@/shared/scholar/client';
import { collectCandidates } from './collection';

afterEach(() => vi.unstubAllGlobals());
const base = newCorpus({
  id: 'corpus',
  title: 'Synthetic corpus',
  kind: 'topic',
  createdAt: at,
  protocol: [
    { version: 1, createdAt: at, body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] } },
  ],
});
const project = newProject({ id: 'project', title: 'Synthetic project', researchQuestion: 'Q?', now: at });
const memberOne = '00000000-0000-4000-8000-000000000001';
const memberTwo = '00000000-0000-4000-8000-000000000002';
const work = (display_name: string, id?: string, doi?: string) => ({ display_name, id, doi });
const kgPaper = (title: string, id: string | null, rank: number, doi?: string) => ({
  title,
  id,
  rank,
  doi,
  authors: ['KG Author'],
  citations: 10,
  venue: 'KG Venue',
  year: 2024,
  score: null,
  abstract: 'Synthetic abstract.',
});
const deps = () => ({
  project,
  corpus: async () => undefined,
  localAbstract: async () => null,
  scholar: createScholarClient({}),
  getLabToken: async () => 'fake-token',
  check: vi.fn(),
  now: () => at,
});

it('S4 searches the lab KG, OpenAlex and then the Project corpus, deduping by DOI, W id and normalized title', async () => {
  const seen: string[] = [];
  const rows = [
    kgPaper('Preferred title', 'W1', 1, 'https://doi.org/10.1000/KG'),
    kgPaper('Matches by W id', 'https://openalex.org/W2', 2),
    kgPaper('Café & methods', null, 3),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/v1/kg/search')) {
        seen.push('lab_kg');
        expect(options.method).toBe('POST');
        expect(options.headers).toMatchObject({ Authorization: 'Bearer fake-token' });
        const params: unknown = JSON.parse(String(options.body));
        expect(params).toMatchObject({ after: '2020-01-01', before: '2025-12-31' });
        return Response.json({ papers: rows, elapsedMs: 0 });
      }
      seen.push('openalex');
      expect(url).toContain('from_publication_date:2020-01-01');
      return Response.json({
        results: [
          work('Other title', 'https://openalex.org/W9', '10.1000/kg'),
          work('Another very different title', 'https://openalex.org/W2'),
          work('Cafe methods'),
          work('OpenAlex only', 'https://openalex.org/W4'),
        ],
      });
    }),
  );
  const existing = addMember(base, { memberId: memberOne, title: 'Corpus only' }, at).corpus;
  const corpus = addMember(
    existing,
    { memberId: memberTwo, doi: '10.1000/kg', title: 'Local duplicate' },
    at,
  ).corpus;
  const plan = { ...outputs.S3, yearFilter: { from: 2020, to: 2025 } };
  const result = await collectCandidates(plan, {
    ...deps(),
    corpus: async () => {
      seen.push('corpus');
      return corpus;
    },
  });
  expect(seen).toEqual(['lab_kg', 'lab_kg', 'openalex', 'openalex', 'corpus']);
  expect(result.candidates.map(({ paper_id }) => paper_id)).toEqual([
    '10.1000/kg',
    'W2',
    'cafe methods',
    'W4',
    'corpus only',
  ]);
  expect(result.candidates[0]).toMatchObject({
    title: 'Preferred title',
    openalexId: 'W1',
    authors: ['KG Author'],
    venue: 'KG Venue',
    citations: 10,
    cite_key: 'P1',
    queryIds: ['search-a', 'search-b'],
    queryLink: 'retrieved',
    source_records: [
      { provider: 'lab_kg', sourceId: 'W1', url: 'https://doi.org/10.1000/kg', retrievedAt: at },
      { provider: 'openalex', sourceId: 'W9', url: 'https://doi.org/10.1000/kg', retrievedAt: at },
      { provider: 'corpus', sourceId: memberTwo, url: 'https://doi.org/10.1000/kg', retrievedAt: at },
    ],
  });
  expect(result.candidates.at(-1)?.queryLink).toBe('pool_context');
  expect(passStage('S4', result, { S3: plan })).toBeNull();
});

it.each(['empty', 'not_configured'] as const)(
  'S4 records %s KG and falls back to OpenAlex',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/kg/search'))
          return status === 'empty'
            ? Response.json({ papers: [], elapsedMs: 0, hint: 'kg_empty' })
            : Response.json({ error: 'kg_not_configured' }, { status: 503 });
        return Response.json({ results: [work('OpenAlex only', 'https://openalex.org/W4')] });
      }),
    );
    const result = await collectCandidates(outputs.S3, deps());
    expect(result.candidates.map(({ id }) => id)).toEqual(['W4']);
    expect(result.meta?.sources).toMatchObject([
      { provider: 'lab_kg', status, errors: status === 'empty' ? [] : [{ message: 'kg_not_configured' }] },
      { provider: 'openalex', status: 'retrieved' },
      { provider: 'corpus', status: 'empty' },
    ]);
  },
);

it('S4 emits NO_LITERATURE and preserves per-source errors when there are no candidates', async () => {
  const fetch = vi.fn(async () => Response.json({}, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const result = await collectCandidates(outputs.S3, {
    ...deps(),
    getLabToken: undefined,
    corpus: async () => {
      throw new Error('local read failure');
    },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.candidates).toEqual([]);
  expect(result.meta?.sources).toMatchObject([
    { provider: 'lab_kg', status: 'not_configured' },
    {
      provider: 'openalex',
      status: 'unavailable',
      errors: [{ queryId: 'search-a' }, { queryId: 'search-b' }],
    },
    { provider: 'corpus', status: 'unavailable', errors: [{ message: 'corpus_read_failed' }] },
  ]);
  expect(passStage('S4', result, outputs)).toBe('NO_LITERATURE');
});
