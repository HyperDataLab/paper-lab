import { expect, it, vi } from 'vitest';
import { createFetchHubClient } from './client';

const baseUrl = 'https://hub.example.invalid';
const key = 'a'.repeat(64);
const updatedAt = '2026-01-01T00:00:00Z';
const getToken = async () => 'synthetic-id-token';

it('batches requests and status in order and sends the ID token to every endpoint', async () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    doi: `10.1000/synthetic-${i}`,
    tag: `member:${i}`,
  }));
  const keys = items.map((_, i) => i.toString(16).padStart(64, '0'));
  const metadata = { r2Key: `paperlab/pdfs/${key}.pdf`, sha256: key, sizeBytes: 10 };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        results: items
          .slice(0, 500)
          .map(({ doi }, i) => ({ doi, doiKey: keys[i], outcome: 'created', status: 'queued' })),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        results: [{ doi: items[500]?.doi, doiKey: keys[500], outcome: 'joined', status: 'done' }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        papers: keys.slice(0, 500).map((doiKey) => ({ doiKey, status: 'queued', updatedAt })),
      }),
    )
    .mockResolvedValueOnce(Response.json({ papers: [{ doiKey: keys[500], status: 'unknown' }] }))
    .mockResolvedValueOnce(Response.json(metadata));
  const token = vi.fn(getToken);
  const client = createFetchHubClient({ baseUrl: ` ${baseUrl}/ `, getToken: token, fetch });

  expect((await client.requestDois(items)).map((item) => item.doi)).toEqual(items.map(({ doi }) => doi));
  expect((await client.status(keys)).map(({ doiKey }) => doiKey)).toEqual(keys);
  expect(await client.pdf(key)).toEqual(metadata);
  expect(fetch.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
    [`${baseUrl}/lab/v1/requests`, { items: items.slice(0, 500) }],
    [`${baseUrl}/lab/v1/requests`, { items: items.slice(500) }],
    [`${baseUrl}/lab/v1/status`, { doiKeys: keys.slice(0, 500) }],
    [`${baseUrl}/lab/v1/status`, { doiKeys: keys.slice(500) }],
    [`${baseUrl}/lab/v1/pdf`, { doiKey: key }],
  ]);
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-id-token', 'Content-Type': 'application/json' },
    });
  }
  expect(token).toHaveBeenCalledTimes(5);
});

it.each([
  [400, 'không hợp lệ'],
  [401, 'Phiên đăng nhập'],
  [403, 'không được phép'],
  [409, 'chưa có PDF'],
  [413, 'tối đa 500'],
  [429, 'chạm giới hạn'],
  [503, 'chưa sẵn sàng'],
])('maps HTTP %s to Vietnamese', async (status, message) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'synthetic_error' }, { status }));
  const client = createFetchHubClient({ baseUrl, getToken, fetch });
  await expect(client.pdf(key)).rejects.toMatchObject({ status, message: expect.stringContaining(message) });
});

it('handles the Hub’s invalid results and distinguishes a submission conflict from PDF readiness', async () => {
  const items = [{ doi: 'synthetic invalid DOI', tag: 'member:synthetic' }];
  const results = [{ doi: items[0]?.doi, outcome: 'invalid' }];
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ results }))
    .mockResolvedValueOnce(Response.json({ error: 'synthetic conflict' }, { status: 409 }));
  const client = createFetchHubClient({ baseUrl, getToken, fetch });
  expect(await client.requestDois(items)).toEqual(results);
  await expect(client.requestDois(items)).rejects.toThrow('gửi lại danh sách DOI');
});

it('handles a network failure and avoids requests without a token or URL', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('synthetic network failure'));
  await expect(createFetchHubClient({ baseUrl, getToken, fetch }).status([key])).rejects.toThrow(
    'Không thể kết nối',
  );
  fetch.mockClear();
  await expect(
    createFetchHubClient({ baseUrl, getToken: async () => null, fetch }).pdf(key),
  ).rejects.toMatchObject({ status: 401 });
  await expect(createFetchHubClient({ baseUrl: '', getToken, fetch }).pdf(key)).rejects.toThrow(
    'Chưa cấu hình',
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('validates each response shape including the PDF copy key', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ results: [{ doi: '10.1000/synthetic', outcome: 'joined', status: 'queued' }] }),
    )
    .mockResolvedValueOnce(Response.json({ papers: [{ doiKey: key, status: 'unexpected', updatedAt }] }))
    .mockResolvedValueOnce(Response.json({ r2Key: `papers/${key}.pdf`, sha256: key, sizeBytes: 10 }))
    .mockResolvedValueOnce(new Response('invalid JSON'));
  const client = createFetchHubClient({ baseUrl, getToken, fetch });
  await expect(client.requestDois([{ doi: '10.1000/synthetic', tag: 'synthetic' }])).rejects.toThrow(
    'không đúng định dạng',
  );
  await expect(client.status([key])).rejects.toThrow('không đúng định dạng');
  await expect(client.pdf(key)).rejects.toThrow('không đúng định dạng');
  await expect(client.pdf(key)).rejects.toThrow('không đúng định dạng');
});
