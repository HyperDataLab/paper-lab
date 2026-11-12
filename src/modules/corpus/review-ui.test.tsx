import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MMAT_CATEGORIES, MMAT_SCREENING } from '@/core/corpus/appraisal';
import { exampleCorpus } from '@/core/corpus/contract';
import { addMember } from '@/core/corpus/intake';
import { recordDecision } from '@/core/corpus/screening';
import type { Corpus } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { chooseSelectOption } from '@/test/selectOption';
import { criterionLabel } from './appraisalLabels';
import DetailPage from './DetailPage';

const client = { completeJson: vi.fn(() => Promise.reject(new Error('no network in tests'))) };
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`review-ui-${crypto.randomUUID()}`));
  const base = exampleCorpus();
  let corpus: Corpus = addMember(
    { ...base, members: [] },
    { doi: '10.1000/seed', openalexId: 'W1', title: 'Seed study', year: 2020 },
    base.createdAt,
  ).corpus;
  const memberId = corpus.members[0]?.memberId ?? '';
  for (const stage of ['title-abstract', 'full-text'] as const) {
    const result = recordDecision(
      corpus,
      memberId,
      { stage, decision: 'include', person: 'An' },
      base.createdAt,
    );
    if (result.ok) corpus = result.corpus;
  }
  await repo.corpora.save(corpus);
  render(
    <MemoryRouter initialEntries={[`/corpus/${corpus.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>
          <Routes>
            <Route path="/corpus/:id" element={<DetailPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: corpus.title });
  return { repo, id: corpus.id };
}

it('C3c snowballing from an included seed shows the citation column in PRISMA', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('referenced_works')
      ? { referenced_works: ['https://openalex.org/W2'] }
      : url.includes('openalex_id:')
        ? {
            results: [{ id: 'https://openalex.org/W2', display_name: 'Cited study', publication_year: 2015 }],
          }
        : { results: [], meta: { count: 0, next_cursor: null } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  const { repo, id } = await setup();
  expect(screen.getByRole('checkbox', { name: 'Seed study' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy snowballing' }));
  expect(await screen.findByText('Vòng 1: thêm 1 bản ghi mới, 0 bản ghi trùng.')).toBeInTheDocument();
  expect((await repo.corpora.get(id))?.searches.map((s) => ('source' in s ? s.source : ''))).toEqual([
    'snowball-backward',
    'snowball-forward',
  ]);
  const other = screen.getByLabelText('PRISMA: Nhận diện (trích dẫn)');
  expect(within(other).getByText('Bản ghi tìm được qua trích dẫn').nextSibling).toHaveTextContent('1');
  expect(screen.getByText(/Chưa có bài nào được chọn thêm kể từ vòng 1/u)).toBeInTheDocument();
});

it('C3d MMAT appraisal needs an appraiser and shows counts without a total score', async () => {
  const { repo, id } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Đánh giá' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu đánh giá' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Nhập tên người đánh giá.');
  fireEvent.change(within(dialog).getByLabelText('Người đánh giá'), { target: { value: 'Bình' } });
  chooseSelectOption('Loại nghiên cứu', '1. Định tính (qualitative)');
  const [category] = MMAT_CATEGORIES;
  for (const [index, item] of [...MMAT_SCREENING, ...category.criteria].entries()) {
    const group = within(dialog).getByRole('radiogroup', { name: criterionLabel(item) });
    fireEvent.click(within(group).getByRole('radio', { name: index === 3 ? 'Không' : 'Có' }));
  }
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu đánh giá' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((await repo.corpora.get(id))?.members[0]?.appraisal).toHaveLength(8);
  const panel = within(screen.getByRole('region', { name: 'Đánh giá chất lượng (MMAT 2018)' }));
  const row = panel.getByRole('cell', { name: 'Seed study' }).closest('tr');
  expect(row).toHaveTextContent('1. Định tính (qualitative)410Bình');
  expect(screen.getByText(/Không có điểm tổng/u)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải đánh giá (CSV)' })).toBeEnabled();
});
