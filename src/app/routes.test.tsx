import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from './App';

// These routes are the SSO build's (ADR 0008); the Firebase build's lab scope is covered in authModes.test.tsx.
vi.mock('@/shared/auth/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/auth/config')>()),
  AUTH_MODE: 'sso',
}));

it('requires a ResearchHub project before the home feature mounts', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: /ResearchHub/u }, { timeout: 5000 })).toBeInTheDocument();
});

it('shows a 404 for unknown paths', () => {
  render(
    <MemoryRouter initialEntries={['/unknown']}>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
});
