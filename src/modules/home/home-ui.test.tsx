import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { newProject } from '@/core/extraction';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Page from './Page';

function Opened() {
  return <p>project {useParams().id}</p>;
}

it('home starts a project from a research question and lists recent work', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`home-ui-${crypto.randomUUID()}`));
  await repo.extraction.save(
    newProject({
      id: crypto.randomUUID(),
      title: 'Project cũ',
      researchQuestion: '',
      now: '2026-01-01T00:00:00.000Z',
    }),
  );
  render(
    <MemoryRouter initialEntries={['/']}>
      <StorageProvider repositories={repo}>
        <Routes>
          <Route path="/" element={<Page />} />
          <Route path="/extraction/:id" element={<Opened />} />
        </Routes>
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: /Project cũ/ })).toBeInTheDocument();
  expect(screen.getByText(/Chưa có bài nào/)).toBeInTheDocument();
  const workflows = screen.getByRole('region', { name: 'Lối tắt' });
  expect(within(workflows).getAllByRole('link')).toHaveLength(4);

  const start = screen.getByRole('button', { name: /Bắt đầu project/ });
  expect(start).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Câu hỏi nghiên cứu'), { target: { value: '  Độ trễ edge?  ' } });
  fireEvent.click(start);
  expect(await screen.findByText(/^project /)).toBeInTheDocument();
  const created = (await repo.extraction.list()).find((item) => item.title === 'Độ trễ edge?');
  expect(created?.researchQuestion).toBe('Độ trễ edge?');
});
