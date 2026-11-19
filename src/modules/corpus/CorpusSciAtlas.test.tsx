import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import type { Corpus, CorpusMember } from '@/core/schemas/corpus';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusOpenKg } from './CorpusOpenKg';

const base = exampleCorpus();
const template = base.members[0];
if (!template) throw new Error('Missing synthetic member');
const member = (memberId: string, doi: string): CorpusMember => ({
  ...template,
  memberId,
  title: `Synthetic ${memberId}`,
  identifiers: { paperIds: [], libraryIds: [], sha256: [], doi },
  stratum: { year: 2024 },
});
const auth: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
afterEach(() => vi.unstubAllGlobals());

it('K4 corpus SciAtlas panel sends corpus keywords, marks members and adds a result by DOI', async () => {
  const repo = createRepositories(createDb(`sciatlas-ui-${crypto.randomUUID()}`));
  const corpus: Corpus = { ...base, members: [member('Alpha', '10.1000/alpha')] };
  const {
    added: [entry],
  } = await repo.library.addDois(['10.1000/alpha']);
  if (!entry) throw new Error('Missing synthetic lookup');
  await repo.library.update(entry.id, {
    keywords: [{ id: 'keywords/synthetic', name: 'Synthetic keyword', score: 0.75 }],
  });
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          elapsedMs: 4,
          papers: [
            {
              rank: 1,
              title: 'Member paper',
              year: 2024,
              score: 1,
              citations: 0,
              venue: null,
              authors: [],
              id: null,
              doi: '10.1000/alpha',
            },
            {
              rank: 2,
              title: 'Outside paper',
              year: 2023,
              score: 0.5,
              citations: 2,
              venue: null,
              authors: [],
              id: null,
              doi: '10.1000/outside',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const save = vi.fn<(value: Corpus) => Promise<void>>();
  function Host() {
    const [current, setCurrent] = useState(corpus);
    return (
      <CorpusOpenKg
        corpus={current}
        save={async (value) => {
          await save(value);
          // The new member gets keywords at once, so the graph and its anchors rebuild after the add.
          const {
            added: [lookup],
          } = await repo.library.addDois(['10.1000/outside']);
          if (lookup)
            await repo.library.update(lookup.id, {
              keywords: [{ id: 'keywords/outside', name: 'Outside keyword', score: 0.9 }],
            });
          setCurrent(value);
        }}
      />
    );
  }
  render(
    <AuthContext.Provider value={auth}>
      <StorageProvider repositories={repo}>
        <Host />
      </StorageProvider>
    </AuthContext.Provider>,
  );
  const panel = await screen.findByRole('region', { name: 'Bài liên quan (KG của lab)' });
  await waitFor(() => expect(within(panel).getByText('Synthetic keyword')).toBeInTheDocument());
  fireEvent.click(within(panel).getByRole('button', { name: 'Tìm' }));
  const list = await within(panel).findByRole('list', { name: 'Bài liên quan (KG của lab)' });
  const [held, outside] = within(list).getAllByRole('listitem');
  if (!held || !outside) throw new Error('missing results');
  expect(within(held).getByText('Đã có trong corpus')).toBeInTheDocument();
  const body = JSON.parse(
    String(
      (fetcher.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
        url.endsWith('/v1/kg/search'),
      )?.[1].body,
    ),
  );
  expect(body).toMatchObject({ keywords: [{ text: 'Synthetic keyword', level: 'high' }], titles: [] });

  fireEvent.click(within(outside).getByRole('button', { name: 'Thêm vào corpus' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = save.mock.calls[0]?.[0];
  expect(saved?.members.map((m) => m.identifiers.doi)).toEqual(['10.1000/alpha', '10.1000/outside']);
  // After the rebuild the result is a member, and the results and sent anchors are still on screen.
  await waitFor(() =>
    expect(
      within(
        screen
          .getAllByRole('listitem')
          .find((item) => item.textContent?.includes('Outside paper')) as HTMLElement,
      ).getByText('Đã có trong corpus'),
    ).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByText('Bài có tra cứu OpenAlex').parentElement).toHaveTextContent('2/2'),
  );
  const after = screen.getByRole('region', { name: 'Bài liên quan (KG của lab)' });
  expect(within(after).getByRole('list', { name: 'Bài liên quan (KG của lab)' })).toBeInTheDocument();
  expect(within(after).queryByText('Outside keyword')).toBeNull();
});
