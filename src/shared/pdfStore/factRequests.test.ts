import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideFactRequest, FactRequestError, getMe, listFactRequests } from './factRequests';

afterEach(() => vi.unstubAllGlobals());
const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
/** Every worker URL carries the project in its query too, in case a proxy drops the header. */
const SCOPE = `projectId=${PROJECT_ID}`;
const request = {
  paperId: `sha256-${'a'.repeat(64)}`,
  state: 'requested',
  note: 'Need facts',
  requestedBy: 'someone@example.org',
  requestedAt: '2026-01-01T00:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
};

describe('fact requests client', () => {
  it('reads who the server says the caller is', async () => {
    const fetchMock = vi.fn(async () => Response.json({ email: 'admin@example.org', admin: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getMe('test-token', PROJECT_ID)).toMatchObject({ admin: true });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/v1/me\\?${SCOPE}$`, 'u')), {
      headers: { Authorization: 'Bearer test-token', 'X-Project-Id': PROJECT_ID },
    });
  });

  it('lists by state and cursor and tolerates missing title and DOI', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        items: [request, { ...request, paperId: 'p2', title: 'T', doi: '10.1/x' }],
        nextCursor: 'c2',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const page = await listFactRequests('test-token', PROJECT_ID, 'approved', 'c1');
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('c2');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/v1/admin/fact-requests\\?state=approved&cursor=c1&${SCOPE}$`, 'u')),
      expect.anything(),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'X-Project-Id': PROJECT_ID } });
  });

  it('sends the decision with a trimmed note, and none when empty', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ...request, state: 'declined' }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await decideFactRequest('t', PROJECT_ID, 'p/1', 'decline', '  out of scope ')).state).toBe(
      'declined',
    );
    await decideFactRequest('t', PROJECT_ID, 'p/1', 'approve', '   ');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(new RegExp(`/fact-requests/p%2F1/decision\\?${SCOPE}$`, 'u')),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer t',
          'X-Project-Id': PROJECT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'decline', note: 'out of scope' }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
  });

  it.each([
    [401, 'Phiên đăng nhập'],
    [403, 'Chỉ quản trị viên'],
    [409, 'đã được xử lý'],
    [400, 'lỗi 400'],
    [503, 'lỗi 503'],
  ])('maps HTTP %i to a Vietnamese reason', async (status, text) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    const failure = decideFactRequest('t', PROJECT_ID, 'p', 'approve');
    await expect(failure).rejects.toBeInstanceOf(FactRequestError);
    await expect(failure).rejects.toThrow(text);
  });
});
