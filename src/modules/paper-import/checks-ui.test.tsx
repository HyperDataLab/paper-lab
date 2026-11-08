import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import PaperMapPage from './PaperMapPage';

it('P4 runs local checks, navigates to evidence, reviews and shows overview counts', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const repo = createRepositories(createDb(`p4-ui-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài kiểm tra',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: null },
    ],
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'An introduction.',
        pageStart: null,
        textHash: '',
      },
      {
        id: 'p2',
        sectionId: 'b',
        order: 1,
        kind: 'body',
        text: '😀 See Figure 2.',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  const completeJson = vi.fn(async () => {
    throw new Error('Unexpected model call');
  });
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByText('An introduction.');
  expect(screen.getByText('Minh bạch')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm tra' }));
  expect(screen.getByText(/Các kiểm tra tự động là thử nghiệm/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chạy kiểm tra' }));
  const heading = await screen.findByRole('heading', { name: 'Hình và bảng' });
  const card = heading.closest('section') ?? heading.parentElement;
  if (!card) throw new Error('Missing card');
  expect(within(card).getByText('Cảnh báo')).toBeInTheDocument();
  expect(screen.getAllByText(/Chưa hiệu chuẩn/)).toHaveLength(6);
  expect(screen.getByLabelText('Ẩn mục chưa đáng tin')).not.toBeChecked();
  expect(screen.getByText(/Lần chạy gần nhất/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: /p2:.*Figure 2/ }));
  expect(screen.getByRole('tab', { name: 'Sơ đồ' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Figure 2', { selector: 'mark' })).toBeInTheDocument();
  expect(scroll).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Kiểm tra' }));
  const cardAgain =
    screen.getByRole('heading', { name: 'Hình và bảng' }).closest('section') ??
    screen.getByRole('heading', { name: 'Hình và bảng' }).parentElement;
  if (!cardAgain) throw new Error('Missing card');
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Xác nhận' }));
  await within(cardAgain).findByText('Đã xác nhận');
  expect(await within(cardAgain).findByText('Chưa hiệu chuẩn (n=1)')).toBeInTheDocument();
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Hoàn tác' }));
  fireEvent.click(await within(cardAgain).findByRole('button', { name: 'Bỏ qua' }));
  const dismissed = await within(cardAgain).findByText('Đã bỏ qua (1)');
  expect(dismissed.parentElement).not.toHaveAttribute('open');
  fireEvent.click(dismissed);
  fireEvent.click(within(cardAgain).getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () =>
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter((e) => e.action === 'review_check'),
    ).toHaveLength(4),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Tổng quan' }));
  expect(await screen.findByText(/Cảnh báo: 1/)).toHaveTextContent('Không áp dụng:');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
  expect(screen.getByRole('tab', { name: 'Kiểm tra' })).toHaveAttribute('aria-selected', 'true');
  expect(completeJson).not.toHaveBeenCalled();
});
