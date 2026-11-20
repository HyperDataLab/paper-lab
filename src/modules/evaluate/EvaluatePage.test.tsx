/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import Page from './Page';
import { MemoryRouter } from 'react-router-dom';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { testRepositories } from '@/shared/storage/testRepositories';
it('EV-01 AC-01 displays two sentences from entered text', async () => {
  vi.stubGlobal('crypto', webcrypto);
  render(
    <MemoryRouter>
      <StorageProvider repositories={testRepositories()}>
        <LlmProvider>
          <Page />
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Dán một paragraph tiếng Anh'), {
    target: { value: 'First sentence. Second sentence.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  expect(await screen.findByText('s1')).toBeInTheDocument();
  expect(screen.getByText('s2')).toBeInTheDocument();
});
