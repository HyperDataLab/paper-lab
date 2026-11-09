import { expect, it } from 'vitest';
import type { LibraryItem } from '../schemas/library';
import {
  EMPTY_FILTER,
  arxivIdFrom,
  bestOpenLink,
  filterLibrary,
  libraryStatus,
  mapCrossref,
  mapEuropePmc,
  mapOpenAlex,
  mapUnpaywall,
  mergeLookups,
  normalizeDoi,
  parseDoiInput,
  statusCounts,
  taxonomyFacets,
  titleMatchesText,
  toRis,
} from './index';

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  doi: '10.1000/alpha',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lookup: 'done',
  title: 'Alpha study',
  authors: ['Ann Lee'],
  year: 2020,
  venue: 'Journal A',
  access: 'open',
  oa_sources: [],
  arxiv_id: null,
  taxonomy: { domain: 'Physical', field: 'Computer', subfield: 'AI', topic: 'Learning', score: 0.9 },
  openalex_id: null,
  paper_id: null,
  file_matches_title: null,
  error: null,
  ...over,
});

it('F1 normalizes DOI forms', () => {
  expect(normalizeDoi('https://doi.org/10.1000/ABC.1')).toBe('10.1000/abc.1');
  expect(normalizeDoi('doi: 10.1000/abc')).toBe('10.1000/abc');
  expect(normalizeDoi('http://dx.doi.org/10.1000/abc.')).toBe('10.1000/abc');
  expect(normalizeDoi('10.1016/S0140(20)30001-1')).toBe('10.1016/s0140(20)30001-1');
  expect(normalizeDoi('(see 10.1000/abc)')).toBeNull();
  expect(normalizeDoi('10.1000/abc)')).toBe('10.1000/abc');
  expect(normalizeDoi('10.1/too-short-prefix')).toBeNull();
  expect(normalizeDoi('not a doi')).toBeNull();
});

it('F1 reads DOIs from lines, links, prose and CSV, and reports what it skipped', () => {
  const parsed = parseDoiInput(`title,doi
"A paper",10.1000/one
https://doi.org/10.1000/two
As shown in doi:10.1000/three, and 10.1000/four.
10.1000/ONE
no identifier here
no doi on this line

10.1002/(sici)1096;2-1<x>`);
  expect(parsed.dois).toEqual([
    '10.1000/one',
    '10.1000/two',
    '10.1000/three',
    '10.1000/four',
    '10.1002/(sici)1096;2-1<x>',
  ]);
  expect(parsed.unmatched).toEqual(['no identifier here', 'no doi on this line']);
});

const work = {
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1000/alpha',
  title: 'A <i>tagged</i>   title',
  publication_year: 2021,
  authorships: [{ author: { display_name: 'Ann Lee' } }, { author: { display_name: null } }],
  primary_location: { source: { display_name: 'Journal A' } },
  open_access: { is_oa: true },
  best_oa_location: {
    landing_page_url: 'https://j.org/a',
    pdf_url: 'https://j.org/a.pdf',
    license: 'cc-by',
    version: 'publishedVersion',
  },
  locations: [
    { landing_page_url: 'https://j.org/a', pdf_url: 'https://j.org/a.pdf', is_oa: true },
    { landing_page_url: 'http://arxiv.org/abs/2006.10256v2', pdf_url: null, is_oa: true },
    { landing_page_url: 'https://closed.example/x', pdf_url: null, is_oa: false },
  ],
  primary_topic: {
    display_name: 'Learning',
    score: 0.9,
    subfield: { display_name: 'AI' },
    field: { display_name: 'Computer' },
    domain: { display_name: 'Physical' },
  },
};

it('F1 F3 maps an OpenAlex work', () => {
  const mapped = mapOpenAlex(work);
  expect(mapped.metadata).toMatchObject({
    title: 'A tagged title',
    authors: ['Ann Lee'],
    year: 2021,
    venue: 'Journal A',
    arxiv_id: '2006.10256',
    taxonomy: { domain: 'Physical', field: 'Computer', subfield: 'AI', topic: 'Learning', score: 0.9 },
  });
  expect(mapped.is_open).toBe(true);
  expect(mapped.sources.some((source) => source.landing_url?.includes('closed'))).toBe(false);
  expect(mapOpenAlex({}).metadata).toMatchObject({
    title: null,
    authors: [],
    taxonomy: null,
    arxiv_id: null,
  });
});

it('F2 finds an arXiv id from a DOI or a link', () => {
  expect(arxivIdFrom([], '10.48550/arXiv.2605.03202')).toBe('2605.03202');
  expect(arxivIdFrom(['https://arxiv.org/pdf/2605.03202v2.pdf'], null)).toBe('2605.03202');
  expect(arxivIdFrom(['https://arxiv.org/abs/hep-th/9901001'], null)).toBe('hep-th/9901001');
  expect(arxivIdFrom(['https://j.org/a', null], null)).toBeNull();
});

it('F1 maps Crossref as a fallback', () => {
  expect(
    mapCrossref({
      message: {
        title: ['A <b>title</b>'],
        author: [{ given: 'Ann', family: 'Lee' }, { name: 'The Consortium' }, {}],
        issued: { 'date-parts': [[2019, 5]] },
        'container-title': ['Journal B'],
      },
    }),
  ).toEqual({ title: 'A title', authors: ['Ann Lee', 'The Consortium'], year: 2019, venue: 'Journal B' });
  expect(mapCrossref({ message: {} })).toEqual({ title: null, authors: [], year: null, venue: null });
});

it('F2 maps Unpaywall and Europe PMC', () => {
  expect(mapUnpaywall({ is_oa: false, best_oa_location: null })).toEqual({ is_open: false, sources: [] });
  expect(
    mapUnpaywall({ is_oa: true, best_oa_location: { url_for_pdf: 'https://u.org/p.pdf' } }).sources[0],
  ).toMatchObject({ source: 'unpaywall', pdf_url: 'https://u.org/p.pdf' });
  const raw = { resultList: { result: [{ doi: '10.1000/ALPHA', pmcid: 'PMC1', isOpenAccess: 'Y' }] } };
  expect(mapEuropePmc(raw, '10.1000/alpha').sources[0]?.landing_url).toContain('PMC1');
  expect(
    mapEuropePmc(
      { resultList: { result: [{ doi: '10.1000/other', pmcid: 'PMC1', isOpenAccess: 'Y' }] } },
      '10.1000/alpha',
    ).is_open,
  ).toBe(false);
  expect(mapEuropePmc({}, '10.1000/alpha').is_open).toBe(false);
});

it('F2 merges sources without duplicates and does not overstate absence', () => {
  const openalex = mapOpenAlex(work);
  const merged = mergeLookups({
    openalex,
    crossref: null,
    oa: [
      {
        is_open: true,
        sources: [
          {
            source: 'unpaywall',
            landing_url: null,
            pdf_url: 'https://J.org/a.pdf',
            license: null,
            version: null,
          },
        ],
      },
    ],
    incomplete: false,
  });
  expect(
    merged.oa_sources.filter((source) => source.pdf_url?.toLowerCase() === 'https://j.org/a.pdf'),
  ).toHaveLength(1);
  expect(merged.access).toBe('open');
  const closed = { crossref: { title: 'T', authors: ['A'], year: 2000, venue: 'V' }, openalex: null, oa: [] };
  expect(mergeLookups({ ...closed, incomplete: false }).access).toBe('none_found');
  expect(mergeLookups({ ...closed, incomplete: true })).toMatchObject({
    access: 'unknown',
    title: 'T',
    authors: ['A'],
  });
});

it('F2 warns when a file does not look like the paper', () => {
  expect(titleMatchesText('Array programming with NumPy', 'array programming with numpy charles')).toBe(true);
  expect(titleMatchesText('Array programming with NumPy', 'a study of soil moisture')).toBe(false);
  expect(titleMatchesText('Short', 'anything')).toBeNull();
  expect(titleMatchesText(null, 'anything')).toBeNull();
});

it('F1 derives each status', () => {
  expect(libraryStatus(item({ paper_id: '00000000-0000-4000-8000-000000000002' }))).toBe('file');
  expect(libraryStatus(item({ lookup: 'pending' }))).toBe('pending');
  expect(libraryStatus(item({ lookup: 'not_found' }))).toBe('not_found');
  expect(libraryStatus(item({ lookup: 'failed' }))).toBe('failed');
  expect(libraryStatus(item())).toBe('open');
  expect(libraryStatus(item({ access: 'none_found' }))).toBe('none_found');
  expect(statusCounts([item(), item(), item({ access: 'unknown' })])).toEqual({ open: 2, unknown: 1 });
});

const beta = item({
  id: '00000000-0000-4000-8000-000000000003',
  doi: '10.1000/beta',
  title: 'Beta trial',
  authors: ['Bo Tran'],
  access: 'none_found',
  taxonomy: { domain: 'Health', field: 'Medicine', subfield: 'X', topic: 'Trials', score: null },
});
const none = item({
  id: '00000000-0000-4000-8000-000000000004',
  doi: '10.1000/none',
  title: null,
  taxonomy: null,
});

it('F1 F3 filters by status, taxonomy and text', () => {
  const all = [item(), beta, none];
  expect(filterLibrary(all, EMPTY_FILTER)).toHaveLength(3);
  expect(filterLibrary(all, { ...EMPTY_FILTER, status: 'none_found' })).toEqual([beta]);
  expect(filterLibrary(all, { ...EMPTY_FILTER, domain: 'Health' })).toEqual([beta]);
  expect(filterLibrary(all, { ...EMPTY_FILTER, field: 'Computer' })).toHaveLength(1);
  expect(filterLibrary(all, { ...EMPTY_FILTER, topic: 'Trials' })).toEqual([beta]);
  expect(filterLibrary(all, { ...EMPTY_FILTER, query: 'bo tr' })).toEqual([beta]);
  expect(filterLibrary(all, { ...EMPTY_FILTER, query: 'ALPHA' })).toHaveLength(1);
  expect(filterLibrary(all, { ...EMPTY_FILTER, query: '10.1000/none' })).toEqual([none]);
});

it('F3 narrows each taxonomy level by the one above, ordered by count', () => {
  const all = [item(), item({ id: '00000000-0000-4000-8000-000000000005' }), beta, none];
  const open = taxonomyFacets(all, { domain: '', field: '' });
  expect(open.domains).toEqual([
    { value: 'Physical', count: 2 },
    { value: 'Health', count: 1 },
  ]);
  const health = taxonomyFacets(all, { domain: 'Health', field: '' });
  expect(health.fields).toEqual([{ value: 'Medicine', count: 1 }]);
  expect(taxonomyFacets(all, { domain: '', field: 'Computer' }).topics).toEqual([
    { value: 'Learning', count: 2 },
  ]);
});

it('F2 prefers a direct PDF link', () => {
  const landing = {
    source: 'openalex' as const,
    landing_url: 'https://j.org',
    pdf_url: null,
    license: null,
    version: null,
  };
  expect(bestOpenLink(item({ oa_sources: [landing, { ...landing, pdf_url: 'https://j.org/p.pdf' }] }))).toBe(
    'https://j.org/p.pdf',
  );
  expect(bestOpenLink(item({ oa_sources: [landing] }))).toBe('https://j.org');
  expect(bestOpenLink(item())).toBeNull();
});

it('F1 writes RIS with one record per paper', () => {
  const text = toRis([
    item({ title: 'Line\nbreak' }),
    item({ title: null, authors: [], year: null, venue: null, doi: '10.1000/x' }),
  ]);
  expect(text).toContain(
    'TY  - JOUR\r\nTI  - Line break\r\nAU  - Ann Lee\r\nPY  - 2020\r\nJO  - Journal A\r\nDO  - 10.1000/alpha\r\nUR  - https://doi.org/10.1000/alpha\r\nER  - ',
  );
  expect(text.match(/ER {2}- /g)).toHaveLength(2);
  expect(toRis([])).toBe('');
});
