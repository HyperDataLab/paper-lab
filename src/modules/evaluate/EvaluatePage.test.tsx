/// <reference types="node" />
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import Page from './Page';
it('EV-01 AC-01 displays two sentences from entered text', async () => {
  vi.stubGlobal('crypto', webcrypto);
  render(<Page />);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'First sentence. Second sentence.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  expect(await screen.findByText('s1')).toBeInTheDocument();
  expect(screen.getByText('s2')).toBeInTheDocument();
});
