import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { modules } from './modules';

beforeEach(() => localStorage.clear());

it('renders the registered routes and current research groups', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
    </MemoryRouter>,
  );

  for (const item of modules.filter((entry) => !entry.partOf && !entry.adminOnly)) {
    if (item.status === 'soon') {
      const node = screen.getByLabelText(item.label, { selector: '[aria-disabled]' });
      expect(node).toHaveAttribute('aria-disabled', 'true');
      expect(node.tagName).not.toBe('A');
    } else {
      expect(screen.getByRole('link', { name: new RegExp(item.label) })).toBeInTheDocument();
    }
  }
});

it('marks the active link and persists collapse', () => {
  const home = modules.find((item) => item.path === '/');
  expect(home).toBeDefined();
  if (!home) return;

  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: home.label })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button'));
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  view.unmount();
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button')).toBeInTheDocument();
});

it('keeps Settings outside the scrollable navigation list', () => {
  const home = modules.find((item) => item.path === '/');
  const settings = modules.find((item) => item.group === 'system' && !item.adminOnly);
  expect(home).toBeDefined();
  expect(settings).toBeDefined();
  if (!home || !settings) return;

  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar />
    </MemoryRouter>,
  );

  expect(screen.getByRole('link', { name: settings.label }).closest('nav')).toBeNull();
  expect(screen.getByRole('link', { name: home.label }).closest('nav')).not.toBeNull();
});

it('continues when storage throws', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toBeInTheDocument();
  get.mockRestore();
  set.mockRestore();
});
