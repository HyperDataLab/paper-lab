import { beforeEach, expect, it, vi } from 'vitest';
import { createScholarClient, ScholarHttpError } from './client';
import { getScholarEmail, isValidEmail, saveScholarEmail } from './settings';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const work = { title: 'T', open_access: { is_oa: false } };
const doi = '10.1000/alpha';

function setup(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    const route = Object.keys(routes).find((key) => url.includes(key));
    return route ? (routes[route] as () => Response)() : json({}, 404);
  });
  return { fetch, calls, sleep: vi.fn(async () => {}) };
}
const client = (s: ReturnType<typeof setup>, email: string | null = null) =>
  createScholarClient({ email }, { fetch: s.fetch, sleep: s.sleep });

it('C4a fetches a cursor page without sending the scholar email', async () => {
  const s = setup({ openalex: () => json({ results: [{ id: 'W1' }], meta: { next_cursor: 'next' } }) });
  const page = await client(s, 'a@b.org').harvestWorks(
    'https://api.openalex.org/works?filter=type:article',
    '*',
  );
  expect(page).toEqual({ results: [{ id: 'W1' }], nextCursor: 'next' });
  const url = new URL(s.calls[0] ?? '');
  expect(url.searchParams.get('cursor')).toBe('*');
  expect(url.searchParams.get('per-page')).toBe('200');
  expect(url.searchParams.has('email')).toBe(false);
  expect(s.sleep).toHaveBeenCalledWith(200);
});

it('F1 uses OpenAlex and sends the email only to Unpaywall', async () => {
  const s = setup({
    openalex: () => json(work),
    unpaywall: () => json({ is_oa: true, best_oa_location: { url_for_pdf: 'https://u.org/p.pdf' } }),
    ebi: () => json({}),
  });
  const outcome = await client(s, 'a@b.org').lookupDoi(doi);
  expect(outcome).toMatchObject({ found: true, patch: { title: 'T', access: 'open' } });
  expect(s.calls.filter((url) => url.includes('a%40b.org')).every((url) => url.includes('unpaywall'))).toBe(
    true,
  );
  expect(s.calls.some((url) => url.includes('a%40b.org'))).toBe(true);
  expect(s.calls.some((url) => url.includes('ebi'))).toBe(false);
});

it('F1 skips Unpaywall without an email and asks Europe PMC', async () => {
  const s = setup({ openalex: () => json(work), ebi: () => json({ resultList: { result: [] } }) });
  const outcome = await client(s).lookupDoi(doi);
  expect(s.calls.some((url) => url.includes('unpaywall'))).toBe(false);
  expect(outcome).toMatchObject({ patch: { access: 'none_found' } });
});

it('F1 falls back to Crossref, then reports a DOI that does not exist', async () => {
  const fallback = setup({
    crossref: () => json({ message: { title: ['From Crossref'] } }),
    ebi: () => json({}),
  });
  expect(await client(fallback).lookupDoi(doi)).toMatchObject({
    found: true,
    patch: { title: 'From Crossref' },
  });
  expect(await client(setup({})).lookupDoi(doi)).toEqual({ found: false });
});

it('F1 retries throttling, honouring Retry-After, then gives up', async () => {
  let count = 0;
  const s = setup({
    openalex: () => (++count === 1 ? json({}, 429, { 'Retry-After': '3' }) : json(work)),
    ebi: () => json({}),
  });
  await client(s).lookupDoi(doi);
  expect(s.sleep).toHaveBeenCalledWith(3000);
  const down = setup({ openalex: () => json({}, 503) });
  await expect(client(down).lookupDoi(doi)).rejects.toBeInstanceOf(ScholarHttpError);
  expect(down.calls).toHaveLength(3);
  const bad = setup({ openalex: () => json({}, 400) });
  await expect(client(bad).lookupDoi(doi)).rejects.toBeInstanceOf(ScholarHttpError);
  expect(bad.calls).toHaveLength(1);
});

it('F2 keeps the metadata and says unknown when an open-access source fails', async () => {
  const s = setup({ openalex: () => json(work), ebi: () => json({}, 400) });
  expect(await client(s).lookupDoi(doi)).toMatchObject({
    found: true,
    patch: { title: 'T', access: 'unknown' },
  });
});

it('F2 stops when cancelled during an open-access lookup', async () => {
  const s = setup({ openalex: () => json(work) });
  s.fetch.mockImplementation(async (input) => {
    if (String(input).includes('openalex')) return json(work);
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(client(s).lookupDoi(doi)).rejects.toMatchObject({ name: 'AbortError' });
});

it('F2 downloads a real PDF from arXiv and refuses anything else', async () => {
  const pdf = () => new Response(new TextEncoder().encode('%PDF-1.4 body'), { status: 200 });
  const ok = setup({ 'arxiv.org/pdf': pdf });
  const file = await client(ok).downloadArxivPdf('2605.03202', 'x.pdf');
  expect(file.name).toBe('x.pdf');
  expect(ok.calls[0]).toBe('https://arxiv.org/pdf/2605.03202');
  const html = setup({ 'arxiv.org/pdf': () => new Response('<html>', { status: 200 }) });
  await expect(client(html).downloadArxivPdf('1', 'x.pdf')).rejects.toThrow('arXiv');
  const gone = setup({ 'arxiv.org/pdf': () => new Response('', { status: 404 }) });
  await expect(client(gone).downloadArxivPdf('1', 'x.pdf')).rejects.toBeInstanceOf(ScholarHttpError);
});

beforeEach(() => localStorage.clear());

it('F2 stores the Unpaywall email only when valid and clears it when empty', () => {
  expect(getScholarEmail()).toBeNull();
  expect(isValidEmail('a@b')).toBe(false);
  expect(saveScholarEmail('bad')).toBe(false);
  expect(saveScholarEmail(' a@b.org ')).toBe(true);
  expect(getScholarEmail()).toBe('a@b.org');
  expect(saveScholarEmail('')).toBe(true);
  expect(getScholarEmail()).toBeNull();
});

it('D1 asks OpenAlex for DOIs only, in batches, and never sends the email', async () => {
  const s = setup({
    openalex: () =>
      json({
        results: [
          { doi: 'https://doi.org/10.1000/a', title: 'A', publication_year: 2020, is_retracted: true },
        ],
      }),
  });
  const dois = Array.from({ length: 51 }, (_, index) => `10.1000/${index}`);
  const statuses = await client(s, 'me@example.org').workStatuses(dois);
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0]).toContain('filter=doi:10.1000%2F0|');
  expect(s.calls.join('')).not.toContain('example.org');
  expect(statuses[0]).toEqual({ doi: '10.1000/a', title: 'A', year: 2020, isRetracted: true });
});

it('asks OpenAlex for one paper by DOI and reports an unknown DOI as null', async () => {
  const s = setup({
    'doi.org%2F': () => json({}, 404),
    openalex: () => json({ display_name: 'P', publication_year: 2024 }),
  });
  const found = await client(s).paperMetadata('10.1/x');
  expect(s.calls[0]).toContain('works/https://doi.org/10.1%2Fx');
  expect(found).toMatchObject({ title: 'P', year: 2024, source: 'openalex' });
  const missing = setup({});
  expect(await client(missing).paperMetadata('10.1/y')).toBeNull();
});

it('rebuilds an abstract from OpenAlex word positions and sends only the DOI', async () => {
  const s = setup({ openalex: () => json({ abstract_inverted_index: { world: [1], Hello: [0] } }) });
  expect(await client(s, 'me@example.org').workAbstract('10.1/x')).toBe('Hello world');
  expect(s.calls[0]).toContain('select=abstract_inverted_index');
  expect(s.calls[0]).not.toContain('example.org');
  const empty = setup({ openalex: () => json({}) });
  expect(await client(empty).workAbstract('10.1/y')).toBeNull();
});

it('searches OpenAlex with the query and year filters only, and follows one citation hop', async () => {
  const s = setup({ openalex: () => json({ results: [{ id: 'W1' }], meta: { count: 7 } }) });
  const found = await client(s, 'me@example.org').searchWorks('edge fog latency', {
    fromYear: 2020,
    toYear: null,
    perPage: 5,
  });
  expect(found).toEqual({ results: [{ id: 'W1' }], total: 7, url: s.calls[0] });
  expect(found.url).not.toContain('example.org');
  expect(s.calls[0]).toContain(
    'search=edge%20fog%20latency&filter=from_publication_date:2020-01-01&per-page=5',
  );
  expect(s.calls[0]).not.toContain('example.org');
  await client(s).searchWorks('x', { fromYear: null, toYear: 2024, perPage: 5 });
  expect(s.calls[1]).toContain('filter=to_publication_date:2024-12-31');
  expect(await client(s).citationWorks('W9', 'cites', 3)).toEqual([{ id: 'W1' }]);
  expect(s.calls[2]).toContain('filter=cites:W9&sort=cited_by_count:desc&per-page=3');
  const empty = setup({});
  expect(await client(empty).searchWorks('x', { fromYear: null, toYear: null, perPage: 5 })).toEqual({
    results: [],
    total: 0,
    url: expect.stringContaining('https://api.openalex.org/works?search=x'),
  });
  expect(await client(empty).citationWorks('W9', 'cited_by', 3)).toEqual([]);
});

it('C3c backward snowballing reads the reference list, then fetches the works 50 ids per request', async () => {
  const refs = Array.from({ length: 51 }, (_, i) => `https://openalex.org/W${100 + i}`);
  const s = setup({
    'works/W1?select=referenced_works': () => json({ referenced_works: refs }),
    'openalex_id:': () => json({ results: [{ id: 'W100' }] }),
  });
  const references = await client(s, 'me@example.org').referencedWorks('https://openalex.org/W1');
  expect(references.ids).toHaveLength(51);
  expect(references.ids[0]).toBe('W100');
  expect(references.url).toBe('https://api.openalex.org/works/W1?select=referenced_works');
  const works = await client(s, 'me@example.org').worksByIds(references.ids);
  expect(works.urls).toHaveLength(2);
  expect(works.urls[0]).toContain(`filter=openalex_id:${references.ids.slice(0, 50).join('|')}&per-page=50`);
  expect(works.urls[1]).toContain('filter=openalex_id:W150&per-page=50');
  expect(works.results).toHaveLength(2);
  expect(s.calls.some((url) => url.includes('example.org'))).toBe(false);
});

it('C3c forward snowballing pages through cites: with a cursor and marks a capped list truncated', async () => {
  let page = 0;
  const s = setup({
    'cites:W1': () => {
      page++;
      return json({
        results: [{ id: `W${page}0` }, { id: `W${page}1` }],
        meta: { count: 4, next_cursor: page < 2 ? `c${page}` : null },
      });
    },
  });
  const all = await client(s).citingWorks('W1', { cap: null });
  expect(all).toMatchObject({ total: 4, truncated: false });
  expect(all.results).toHaveLength(4);
  expect(all.urls[0]).toContain('filter=cites:W1&per-page=200');
  expect(all.urls[0]).toContain('cursor=*');
  expect(all.urls[1]).toContain('cursor=c1');
  page = 0;
  const capped = await client(s).citingWorks('W1', { cap: 3 });
  expect(capped.results).toHaveLength(3);
  expect(capped.truncated).toBe(true);
  const rerun = await client(s).fetchWorks('https://api.openalex.org/works?search=x&filter=cites:W1');
  expect(rerun.url).toBe('https://api.openalex.org/works?search=x&filter=cites:W1');
  expect(rerun.total).toBe(4);
});
