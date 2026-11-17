import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { addFromDois, addFromLibrary } from '@/core/corpus/intake';
import { buildCorpusKeywords } from '@/core/corpusKeywords';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusKeywords } from './CorpusKeywords';

const kw = (slug: string, score: number) => ({ id: `keywords/${slug}`, name: slug, score });

async function seed() {
  const repo = createRepositories(createDb(`keywords-ui-${crypto.randomUUID()}`));
  const { added } = await repo.library.addDois(['10.1000/one', '10.1000/two']);
  const [one, two] = added;
  if (!one || !two) throw new Error('missing items');
  await repo.library.update(one.id, {
    title: 'Synthetic one',
    year: 2020,
    keywords: [kw('alpha', 0.9), kw('beta', 0.3)],
  });
  await repo.library.update(two.id, { title: 'Synthetic two', year: 2021, keywords: [kw('alpha', 0.5)] });
  const withLibrary = addFromLibrary(exampleCorpus(), [
    (await repo.library.get(one.id)) ?? one,
    (await repo.library.get(two.id)) ?? two,
  ]).corpus;
  const corpus = addFromDois(withLibrary, '10.1000/three\n10.1000/four').corpus;
  return { repo, corpus };
}

it('renders the cloud and table from a stored collection and lists a keyword’s papers', async () => {
  const { repo, corpus } = await seed();
  const found = await repo.corpusKeywords.memberKeywords(corpus);
  await repo.corpusKeywords.save(
    buildCorpusKeywords({
      corpusId: corpus.id,
      memberIds: corpus.members.map((member) => member.memberId),
      papers: found.papers,
      computedAt: '2026-11-18T00:00:00.000Z',
    }),
  );
  render(
    <StorageProvider repositories={repo}>
      <CorpusKeywords corpus={corpus} makeClient={() => ({ workKeywords: vi.fn() })} />
    </StorageProvider>,
  );
  const cloud = await screen.findByRole('group', { name: /Đám mây 2 keyword/ });
  expect(within(cloud).getByRole('button', { name: 'alpha: 2 bài, điểm TB 0.70' })).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Keyword của corpus' });
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('alpha2100.0%0.70');
  expect(screen.queryByText('Đã cũ')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lấy keywords cho 2 bài còn thiếu' })).toBeInTheDocument();
  expect(screen.getByText(/1 bài không có DOI/)).toBeInTheDocument();

  fireEvent.click(within(cloud).getByRole('button', { name: /^beta/ }));
  const list = screen.getByRole('list', { name: 'Các bài có keyword beta' });
  expect(list).toHaveTextContent('Synthetic one (2020)');

  fireEvent.click(screen.getByRole('combobox', { name: 'Năm' }));
  fireEvent.click(await screen.findByRole('option', { name: '2021' }));
  expect(await screen.findByRole('group', { name: /Đám mây 1 keyword/ })).toBeInTheDocument();
});

it('fetches missing keywords by DOI, then rebuilds the collection', async () => {
  const { repo, corpus } = await seed();
  const workKeywords = vi.fn(async (doi: string) => (doi === '10.1000/three' ? [kw('gamma', 0.8)] : null));
  render(
    <StorageProvider repositories={repo}>
      <CorpusKeywords corpus={corpus} makeClient={() => ({ workKeywords })} />
    </StorageProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Lấy keywords cho 2 bài còn thiếu' }));
  expect(screen.getByText('Chưa tính bộ keyword cho corpus này.')).toBeInTheDocument();
  expect(await screen.findByText('Đã lấy keywords cho 2 bài.')).toBeInTheDocument();
  expect(workKeywords.mock.calls.map(([doi]) => doi).sort()).toEqual(['10.1000/four', '10.1000/three']);
  expect(screen.queryByRole('button', { name: /bài còn thiếu/ })).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'gamma: 1 bài, điểm TB 0.80' })).toBeInTheDocument();
  expect((await repo.corpusKeywords.get(corpus.id))?.papersWithKeywords).toBe(3);
  expect(await repo.library.list()).toHaveLength(2);
});
