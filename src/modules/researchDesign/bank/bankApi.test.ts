import { expect, it, vi } from 'vitest';
import { BankApiError, createBankClient } from './bankApi';

const release = {
  release: '2031.02.1',
  date: '2031-02-01T00:00:00Z',
  notes: 'Test',
  includesDrafts: true,
};

it('D53 sends the token and reads the exact release and snapshot paths', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release)))
    .mockResolvedValueOnce(new Response('{"raw":true}'));
  const api = createBankClient({
    baseUrl: 'https://bank.example/',
    getToken: async () => 'token',
    fetch: fetcher,
  });
  expect(await api.getRelease()).toEqual({ status: 'release', release });
  const snapshot = await api.getSnapshot();
  if (snapshot.status !== 'snapshot') throw new Error('expected a snapshot');
  expect(new TextDecoder().decode(snapshot.bytes)).toBe('{"raw":true}');
  expect(fetcher).toHaveBeenNthCalledWith(1, 'https://bank.example/bank/v1/release', {
    method: 'GET',
    headers: { Authorization: 'Bearer token' },
  });
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    'https://bank.example/bank/v1/snapshot?collections=designs,threats,claim-types,metrics,protocols,benchmarks',
    expect.anything(),
  );
});

it('D31 sends If-None-Match for a bank release only and reads 304 as current', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(release)));
  const api = createBankClient({
    baseUrl: 'https://bank.example',
    getToken: async () => 't',
    fetch: fetcher,
  });
  expect(await api.getRelease('2031.02.1')).toEqual({ status: 'current' });
  expect(await api.getSnapshot('2031.02.1')).toEqual({ status: 'current' });
  await api.getRelease('sha256:0123456789abcdef');
  expect(fetcher.mock.calls[0]?.[1]).toEqual({
    method: 'GET',
    headers: { Authorization: 'Bearer t', 'If-None-Match': '"2031.02.1"' },
  });
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { 'If-None-Match': '"2031.02.1"' } });
  expect(fetcher.mock.calls[2]?.[1]).toEqual({ method: 'GET', headers: { Authorization: 'Bearer t' } });
});

it('D53 maps HTTP errors, retry seconds, missing tokens, bad bodies and network failures', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'rate_limited', message: 'Slow down' }), {
        status: 429,
        headers: { 'Retry-After': '23' },
      }),
    )
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response('not json', { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ release: 1 })));
  const api = createBankClient({ baseUrl: '', getToken: async () => 'token', fetch: fetcher });
  await expect(api.getRelease()).rejects.toMatchObject({
    status: 429,
    code: 'rate_limited',
    message: 'Slow down',
    retryAfter: 23,
  });
  await expect(api.getSnapshot()).rejects.toMatchObject({ status: 0, code: 'network' });
  await expect(api.getRelease()).rejects.toMatchObject({ status: 500, code: 'unknown' });
  await expect(api.getRelease()).rejects.toMatchObject({ code: 'invalid' });
  const signedOut = createBankClient({ baseUrl: '', getToken: async () => null, fetch: fetcher });
  await expect(signedOut.getRelease()).rejects.toBeInstanceOf(BankApiError);
  await expect(signedOut.getSnapshot()).rejects.toMatchObject({ code: 'signed_out' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
