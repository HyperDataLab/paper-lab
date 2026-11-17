import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import ProjectPage from './ProjectPage';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function mountProject(paperId: string | null, search = '') {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`design-shell-${crypto.randomUUID()}`));
  const project = await repo.extraction.save({
    ...newProject({
      id: crypto.randomUUID(),
      title: 'Project thử',
      researchQuestion: '',
      now: '2026-01-01T00:00:00.000Z',
    }),
    paperId,
  });
  render(
    <MemoryRouter initialEntries={[`/extraction/${project.id}${search}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Location />
          <Routes>
            <Route path="/extraction/:id" element={<ProjectPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Project thử' });
}

it('shows the ordered sections on a multi-paper project and changes the linked section', async () => {
  await mountProject(null, '?other=kept');
  const tabs = within(screen.getByRole('tablist', { name: 'Thiết kế nghiên cứu' })).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Câu hỏi và giả thuyết',
    'Thiết kế nghiên cứu',
    'Đo lường',
    'Writing Bank',
    'Phân tích thống kê',
    'Ma trận chạy',
    'Bảng so sánh',
    'Gói kế hoạch',
  ]);
  expect(await screen.findByText('Đang chuyển từ Research Design')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Writing Bank' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?other=kept&design=bank'));
  expect(await within(screen.getByRole('tabpanel')).findByText('Writing Bank')).toBeInTheDocument();
  expect(
    within(screen.getByRole('tabpanel')).getByText('Đang chuyển từ Research Design'),
  ).toBeInTheDocument();
});

it('opens a section from a deep link', async () => {
  await mountProject(null, '?design=evidence');
  expect(screen.getByRole('tab', { name: 'Bảng so sánh' })).toHaveAttribute('aria-selected', 'true');
  expect(await within(screen.getByRole('tabpanel')).findByText('Bảng so sánh')).toBeInTheDocument();
});

it('does not show the area on a paper-owned project', async () => {
  await mountProject('00000000-0000-4000-8000-000000000001');
  expect(screen.queryByRole('tablist', { name: 'Thiết kế nghiên cứu' })).not.toBeInTheDocument();
});
