import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { fixturePaper, PAPER_ID } from '@/core/measurement/testFixture';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import PaperMapPage from './PaperMapPage';

afterEach(() => vi.unstubAllGlobals());
it('R17b the Trích xuất tab opens on this paper with template columns and offers exports', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  const repo = createRepositories(createDb(`r17b-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  render(
    <MemoryRouter initialEntries={[`/papers/${PAPER_ID}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson: vi.fn() }}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Trích xuất' }));
  const table = await screen.findByRole('table');
  expect(within(table).getByText('Objectives')).toBeInTheDocument();
  expect(within(table).getByText('Experimental Protocol')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xuất' }));
  expect(screen.queryByRole('button', { name: 'Thêm bài' })).toBeNull();
  for (const name of ['CSV', 'JSON kèm bằng chứng', 'RIS của bài này', 'BibTeX của bài này'])
    expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
});
