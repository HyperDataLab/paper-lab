import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { Paper } from '@/core/schemas';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Page from './Page';

const at = '2026-01-01T00:00:00.000Z';
function paper(file: string, firstLine: string, createdAt: string): Paper {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: file,
    createdAt,
    updatedAt: createdAt,
    source: { kind: 'pdf', fileName: `${file}.pdf`, pageCount: 12, sha256: file },
    sections: [{ id: 'front', heading: 'Front matter', role: 'other', level: 1, pageStart: 1 }],
    paragraphs: [
      { id: 'p1', sectionId: 'front', order: 0, kind: 'body', text: firstLine, pageStart: 1, textHash: 'a' },
    ],
  };
}

it('the library lists papers by title, authors and year, and can be searched and sorted', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`library-table-${crypto.randomUUID()}`));
  const looked = paper('2605.03202v2', 'Stop Automating Peer Review', at);
  const detected = paper('scan-01', 'Edge Offloading at Scale', '2026-02-01T00:00:00.000Z');
  const unnamed = paper('notes', 'v1', '2026-03-01T00:00:00.000Z');
  for (const item of [looked, detected, unnamed]) await repo.papers.create(item);
  await repo.paperContext.save({
    schemaVersion: 1,
    paperId: looked.id,
    checkedAt: at,
    paperDoi: null,
    checked: 0,
    found: 0,
    retracted: [],
    retractionChecked: false,
    metadata: {
      source: 'openalex',
      fetchedAt: at,
      doi: null,
      title: 'Stop Automating Peer Review Without Rigorous Evaluation',
      type: 'preprint',
      year: 2026,
      authors: ['Joachim Baumann', 'Jiaxin Pei'],
      venue: 'arXiv',
      volume: null,
      issue: null,
      pages: null,
      citedBy: 3,
      topic: null,
    },
  });
  render(
    <MemoryRouter initialEntries={['/papers']}>
      <StorageProvider repositories={repo}>
        <Page />
      </StorageProvider>
    </MemoryRouter>,
  );
  const table = await screen.findByRole('table');
  const titles = () =>
    within(table)
      .getAllByRole('rowheader')
      .map((cell) => within(cell).getByRole('link').textContent);
  // Newest import first; the file name is the title only when nothing better is known.
  expect(titles()).toEqual([
    'notes',
    'Edge Offloading at Scale',
    'Stop Automating Peer Review Without Rigorous Evaluation',
  ]);
  const row = screen.getByRole('row', { name: /Stop Automating Peer Review Without/ });
  expect(within(row).getByText('Joachim Baumann, Jiaxin Pei')).toBeInTheDocument();
  expect(within(row).getByText('2026')).toBeInTheDocument();
  expect(within(row).getByText('arXiv')).toBeInTheDocument();
  expect(within(row).getByText('2605.03202v2.pdf')).toBeInTheDocument();
  expect(screen.getByText('scan-01.pdf · Tên dò từ trang đầu')).toBeInTheDocument();
  expect(screen.getByText('Tên tệp · chưa có metadata')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Sắp xếp'), { target: { value: 'title' } });
  expect(titles()[0]).toBe('Edge Offloading at Scale');
  fireEvent.change(screen.getByLabelText('Sắp xếp'), { target: { value: 'year' } });
  expect(titles()[0]).toBe('Stop Automating Peer Review Without Rigorous Evaluation');

  // Search covers authors and file names, not only titles.
  fireEvent.change(screen.getByLabelText('Tìm bài'), { target: { value: 'baumann' } });
  expect(titles()).toEqual(['Stop Automating Peer Review Without Rigorous Evaluation']);
  fireEvent.change(screen.getByLabelText('Tìm bài'), { target: { value: 'scan-01' } });
  expect(titles()).toEqual(['Edge Offloading at Scale']);
  fireEvent.change(screen.getByLabelText('Tìm bài'), { target: { value: 'zzz' } });
  expect(screen.getByText('Không có bài nào khớp “zzz”.')).toBeInTheDocument();
});
