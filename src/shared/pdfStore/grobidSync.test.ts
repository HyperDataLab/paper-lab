import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { grobidPaper, grobidRecord, grobidTei } from '@/test/grobidFixtures';
import { requestGrobid } from './grobidSync';
import { testRepositories } from '@/shared/storage/testRepositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const repo = testRepositories();
  await repo.papers.create(grobidPaper);
  await repo.grobid.save(grobidRecord());
  return repo;
}

it.each([
  ['network failure', () => Promise.reject(new TypeError('offline'))],
  ['timeout', () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
  ['no body', () => Promise.resolve(new Response(grobidTei.replace(/<body>[\s\S]*?<\/body>/u, '<body/>')))],
  [
    'fewer references',
    () => Promise.resolve(new Response(grobidTei.replace(/<listBibl>[\s\S]*?<\/listBibl>/u, '<listBibl/>'))),
  ],
  [
    'fewer citations',
    () => Promise.resolve(new Response(grobidTei.replace(/<ref type="bibr"[^>]*>[\s\S]*?<\/ref>/gu, ''))),
  ],
])('keeps the previous result after %s', async (_name, fetcher) => {
  const repo = await setup();
  vi.stubGlobal('fetch', vi.fn(fetcher));
  const saved = await requestGrobid(
    repo,
    grobidPaper,
    '00000000-0000-4000-8000-000000000001',
    async () => 'token',
  );
  expect(saved.result).toEqual(grobidRecord().result);
  expect(saved.fetchedAt).toBe(grobidRecord().fetchedAt);
  expect(saved.lastFailedAttempt).toEqual({ at: expect.any(String), reason: expect.any(String) });
  expect(await repo.grobid.get(grobidPaper.id)).toEqual(saved);
});

it('allows an explicit replacement with a degraded result', async () => {
  const repo = await setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(grobidTei.replace(/<body>[\s\S]*?<\/body>/u, '<body/>'))),
  );
  const saved = await requestGrobid(
    repo,
    grobidPaper,
    '00000000-0000-4000-8000-000000000001',
    async () => 'token',
    undefined,
    true,
  );
  expect(saved.result?.bodyPresent).toBe(false);
  expect(saved.lastFailedAttempt).toBeUndefined();
});
