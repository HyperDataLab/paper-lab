import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { NotInKg } from './NotInKg';

const auth: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const status = (logs: { id: string; code: string }[]) =>
  json({
    counts: { pending: 1, processing: 0, done: 0, failed: 0 },
    logs: logs.map((log) => ({ ...log, attempts: 1, at: '2026-11-19T00:00:00.000Z' })),
  });

const detail = {
  paper: {
    id: 'W77',
    doi: null,
    title: 'Synthetic queued paper',
    abstract: null,
    year: 2024,
    citations: 0,
    type: null,
    venue: null,
  },
  keywords: [],
  topics: [],
  authors: [],
  cites: [],
  citedBy: [],
  contributions: [],
};

function show(fetcher: (path: string) => Response, onPresent = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => fetcher(new URL(input).pathname.replace(/^.*\/v1\/kg/u, ''))),
  );
  render(
    <AuthContext.Provider value={auth}>
      <NotInKg
        centre={{ id: 'W77', kind: 'paper' }}
        onPresent={onPresent}
        onSearch={() => undefined}
        pollMs={5}
        waitMs={200}
      />
    </AuthContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đưa bài này vào KG' }));
  return onPresent;
}

afterEach(() => vi.unstubAllGlobals());

describe('L4 ingest from the explorer', () => {
  it('L4 polls until a queued paper appears, then centres on it', async () => {
    let polls = 0;
    const onPresent = show((path) => {
      if (path === '/ingest')
        return json({
          queued: 1,
          processed: 0,
          skipped: 0,
          errors: [{ id: 'W77', code: 'openalex_unavailable' }],
        });
      if (path === '/ingest/status') return status([{ id: 'W77', code: 'openalex_unavailable' }]);
      polls += 1;
      return polls < 3 ? json({ error: 'not_found' }, 404) : json(detail);
    });
    expect(await screen.findByText(/Đang chờ bài xuất hiện trong KG/u)).toBeTruthy();
    expect(screen.getByText(/máy chủ lab sẽ tự thử lại/u)).toBeTruthy();
    await vi.waitFor(() => expect(onPresent).toHaveBeenCalledTimes(1));
    expect(polls).toBe(3);
  });

  it('L4 stops when OpenAlex has no such work', async () => {
    const onPresent = show((path) =>
      path === '/ingest'
        ? json({ queued: 1, processed: 0, skipped: 0, errors: [{ id: 'W77', code: 'openalex_not_found' }] })
        : json({ error: 'not_found' }, 404),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('OpenAlex không có bài này');
    expect(onPresent).not.toHaveBeenCalled();
  });

  it('L4 says the paper is still queued after the wait', async () => {
    show((path) =>
      path === '/ingest'
        ? json({ queued: 1, processed: 0, skipped: 0, errors: [] })
        : path === '/ingest/status'
          ? status([])
          : json({ error: 'not_found' }, 404),
    );
    expect(
      await screen.findByText(/Bài vẫn đang trong hàng chờ/u, undefined, { timeout: 2000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đưa bài này vào KG' })).toBeTruthy();
  });
});
