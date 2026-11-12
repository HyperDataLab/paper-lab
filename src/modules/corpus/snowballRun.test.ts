import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addMember } from '@/core/corpus/intake';
import { prismaCounts } from '@/core/corpus/prisma';
import { recordSnowball } from '@/core/corpus/snowball';
import { createScholarClient } from '@/shared/scholar/client';
import { runSnowball } from './snowballRun';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const work = (n: number) => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.1000/w${n}`,
  display_name: `Work ${n}`,
  publication_year: 2020,
});

function setup() {
  const base = exampleCorpus();
  const corpus = addMember(
    { ...base, members: [] },
    { doi: '10.1000/seed', openalexId: 'W1', title: 'Seed', year: 2019 },
    base.createdAt,
  ).corpus;
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('select=referenced_works'))
      return json({ referenced_works: ['https://openalex.org/W2', 'https://openalex.org/W3'] });
    if (url.includes('openalex_id:')) return json({ results: [work(2), work(3)] });
    // W5 has no title, so it cannot become a record.
    if (url.includes('cites:W1'))
      return json({
        results: [work(4), { id: 'https://openalex.org/W5' }],
        meta: { count: 2, next_cursor: null },
      });
    return new Response('{}', { status: 404 });
  });
  const client = createScholarClient({ email: null }, { fetch, sleep: async () => {} });
  return { corpus, calls, client, seed: corpus.members[0] };
}

it('C3c backward and forward snowballing request OpenAlex and take the records through intake', async () => {
  const { corpus, calls, client, seed } = setup();
  if (!seed) throw new Error('no seed');
  const backward = await runSnowball(client, [seed], 'backward', null);
  expect(calls).toEqual([
    'https://api.openalex.org/works/W1?select=referenced_works',
    expect.stringContaining('filter=openalex_id:W2|W3&per-page=50'),
  ]);
  expect(backward).toMatchObject({
    seeds: [seed.memberId],
    totalReported: 2,
    retrieved: 2,
    truncated: false,
  });
  const forward = await runSnowball(client, [seed], 'forward', null);
  expect(calls[2]).toContain('filter=cites:W1&per-page=200');
  expect(forward).toMatchObject({ totalReported: 2, retrieved: 1 });
  let next = recordSnowball(corpus, backward, 1, '2026-02-01T00:00:00.000Z');
  next = recordSnowball(next, forward, 1, '2026-02-01T00:00:00.000Z');
  expect(next.members.map((m) => m.identifiers.openalexId)).toEqual(['W1', 'W2', 'W3', 'W4']);
  expect(next.searches.map((s) => ('source' in s ? s.source : ''))).toEqual([
    'snowball-backward',
    'snowball-forward',
  ]);
  expect(next.searches[0]).toMatchObject({
    requestUrls: calls.slice(0, 2),
    added: 2,
    seeds: [seed.memberId],
  });
  expect(prismaCounts(next).otherMethods).toMatchObject({ identified: 3, recordsOutsideSearches: 0 });
  const capped = await runSnowball(client, [seed], 'backward', 1);
  expect(capped).toMatchObject({ totalReported: 2, truncated: true });
});
