import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { grobidPaper, grobidRecord } from '@/test/grobidFixtures';
import { PaperOpenKg } from './PaperOpenKg';
import { testRepositories } from '@/shared/storage/testRepositories';

const auth: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
afterEach(() => vi.unstubAllGlobals());

it('K4 paper OpenKG tab sends keyword, title and GROBID reference anchors and marks Library papers', async () => {
  const repo = testRepositories();
  await repo.papers.create(grobidPaper);
  await repo.grobid.save(grobidRecord());
  const {
    added: [own, other],
  } = await repo.library.addDois(['10.1000/own', '10.1000/library']);
  if (!own || !other) throw new Error('Missing synthetic lookups');
  await repo.library.update(own.id, {
    paper_id: grobidPaper.id,
    year: 2020,
    keywords: [
      { id: 'keywords/high', name: 'High keyword', score: 0.8 },
      { id: 'keywords/low', name: 'Low keyword', score: 0.1 },
    ],
  });
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          elapsedMs: 3,
          papers: [
            {
              rank: 1,
              title: 'Library synthetic paper',
              year: 2021,
              score: null,
              citations: null,
              venue: null,
              authors: [],
              id: null,
              doi: '10.1000/library',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <AuthContext.Provider value={auth}>
      <StorageProvider repositories={repo}>
        <PaperOpenKg paper={grobidPaper} onLocation={() => {}} />
      </StorageProvider>
    </AuthContext.Provider>,
  );
  const panel = await screen.findByRole('region', { name: 'Bài liên quan (KG của lab)' });
  expect(within(panel).getByText('High keyword')).toBeInTheDocument();
  expect(within(panel).queryByText('Low keyword')).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: 'Tìm' }));
  const list = await within(panel).findByRole('list', { name: 'Bài liên quan (KG của lab)' });
  expect(within(list).getByText('Đã có trong Library')).toBeInTheDocument();
  expect(within(list).queryByRole('button', { name: 'Thêm vào corpus' })).toBeNull();
  const body = JSON.parse(
    String(
      (fetcher.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
        url.endsWith('/v1/kg/search?projectId=00000000-0000-4000-8000-000000000001'),
      )?.[1].body,
    ),
  );
  expect(body).toMatchObject({
    keywords: [{ text: 'High keyword', level: 'high' }],
    titles: [{ title: grobidPaper.title, level: 'high' }],
    references: ['Slow synthetic models', 'Unused synthetic note'],
    after: '2015-01-01',
    before: '2025-12-31',
  });
});
