import { expect, it } from 'vitest';
import { LibraryItemSchema } from '../schemas/library';
import { mapOpenAlex, mapOpenAlexKeywords, mergeLookups, openAlexKeywordId } from './lookup';

const keyword = (slug: string, score: number, name = slug.replace(/-/gu, ' ')) => ({
  id: `https://openalex.org/keywords/${slug}`,
  display_name: name,
  score,
});

it('maps OpenAlex keywords to short ids, highest score first', () => {
  const mapped = mapOpenAlex({
    keywords: [keyword('alpha-term', 0.4), keyword('beta-term', 0.9, 'Beta term')],
  });
  expect(mapped.metadata.keywords).toEqual([
    { id: 'keywords/beta-term', name: 'Beta term', score: 0.9 },
    { id: 'keywords/alpha-term', name: 'alpha term', score: 0.4 },
  ]);
});

it('treats missing or non-list keywords as none', () => {
  expect(mapOpenAlex({}).metadata.keywords).toEqual([]);
  expect(mapOpenAlex({ keywords: null }).metadata.keywords).toEqual([]);
  expect(mapOpenAlex({ keywords: 'x' }).metadata.keywords).toEqual([]);
});

it('drops malformed keyword entries without failing the lookup', () => {
  const mapped = mapOpenAlexKeywords([
    keyword('good-one', 0.5),
    { id: 'https://openalex.org/topics/T123', display_name: 'Topic', score: 0.9 },
    { id: 'https://openalex.org/keywords/', display_name: 'Empty slug', score: 0.9 },
    { id: 'https://openalex.org/keywords/no name', display_name: 'Space', score: 0.9 },
    { id: 'https://openalex.org/keywords/nameless', display_name: '  ', score: 0.9 },
    { id: 42, display_name: 'Bad id type' },
    null,
    'text',
    { id: 'https://openalex.org/keywords/no-score', display_name: 'No score' },
  ]);
  expect(mapped).toEqual([
    { id: 'keywords/good-one', name: 'good one', score: 0.5 },
    { id: 'keywords/no-score', name: 'No score', score: 0 },
  ]);
});

it('keeps one entry per id and at most twenty keywords', () => {
  const many = Array.from({ length: 25 }, (_, i) => keyword(`k-${String(i).padStart(2, '0')}`, i / 100));
  const mapped = mapOpenAlexKeywords([...many, keyword('k-24', 0.01)]);
  expect(mapped).toHaveLength(20);
  expect(mapped[0]).toEqual({ id: 'keywords/k-24', name: 'k 24', score: 0.24 });
  expect(new Set(mapped.map((item) => item.id)).size).toBe(20);
});

it('normalises keyword ids', () => {
  expect(openAlexKeywordId('https://openalex.org/keywords/Edge-Computing')).toBe('keywords/edge-computing');
  expect(openAlexKeywordId('keywords/edge-computing')).toBe('keywords/edge-computing');
  expect(openAlexKeywordId('https://openalex.org/subfields/1702')).toBeNull();
  expect(openAlexKeywordId(null)).toBeNull();
});

it('puts keywords in the lookup patch only when OpenAlex answered', () => {
  const openalex = mapOpenAlex({ keywords: [keyword('alpha-term', 0.4)] });
  expect(mergeLookups({ openalex, crossref: null, oa: [], incomplete: false }).keywords).toEqual([
    { id: 'keywords/alpha-term', name: 'alpha term', score: 0.4 },
  ]);
  const crossrefOnly = mergeLookups({
    openalex: null,
    crossref: { title: 'T', authors: [], year: 2020, venue: null },
    oa: [],
    incomplete: false,
  });
  expect('keywords' in crossrefOnly).toBe(false);
});

it('parses library records saved before keywords were kept', () => {
  const old = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    doi: '10.1000/x',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lookup: 'done',
    title: null,
    authors: [],
    year: null,
    venue: null,
    access: 'unknown',
    oa_sources: [],
    arxiv_id: null,
    taxonomy: null,
    openalex_id: null,
    paper_id: null,
    file_matches_title: null,
    error: null,
  };
  expect(LibraryItemSchema.parse(old).keywords).toBeUndefined();
  expect(() => LibraryItemSchema.parse({ ...old, keywords: [{ id: 'bad', name: 'x', score: 1 }] })).toThrow();
});
