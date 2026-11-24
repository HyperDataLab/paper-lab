import { afterEach, expect, it, vi } from 'vitest';
import { listResearchHubProjects } from './researchHubProjects';

afterEach(() => vi.unstubAllGlobals());

it('requests only the signed-in account project list from the Worker', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      items: [
        { id: '00000000-0000-4000-8000-000000000001', name: 'Project One' },
        { id: 'invalid', name: 'Not a project id' },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await expect(listResearchHubProjects('access-token')).resolves.toEqual([
    { id: '00000000-0000-4000-8000-000000000001', name: 'Project One' },
  ]);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/paperlab-worker/v1/me/projects');
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: 'Bearer access-token' },
    cache: 'no-store',
  });
});

it('surfaces project listing errors without accepting a malformed response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Worker unavailable' }, { status: 502 })),
  );
  await expect(listResearchHubProjects('access-token')).rejects.toThrow('Worker unavailable');

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ projects: [] })),
  );
  await expect(listResearchHubProjects('access-token')).rejects.toThrow('danh sách project không hợp lệ');
});
