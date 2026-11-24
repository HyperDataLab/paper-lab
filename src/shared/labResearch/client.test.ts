import { expect, it, vi } from 'vitest';
import { createLabResearchClient } from './client';
const client = (fetcher: typeof fetch, baseUrl = 'https://example.test', token: string | null = 'token') =>
  createLabResearchClient({ baseUrl, getToken: async () => token, fetch: fetcher });
it('sends a tool call and validates its envelope', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, output: { count: 3 } })));
  expect(await client(fetcher).callTool('test', { q: 'x' })).toEqual({ count: 3 });
  expect(fetcher).toHaveBeenCalledWith(
    'https://example.test/v1/tools/test',
    expect.objectContaining({
      method: 'POST',
      body: '{"q":"x"}',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    }),
  );
});
it('requires a token', async () => {
  await expect(client(vi.fn(), undefined, null).callTool('x', {})).rejects.toMatchObject({
    status: 401,
    code: 'signed_out',
  });
});
it('reports a network error', async () => {
  await expect(client(vi.fn().mockRejectedValue(new Error())).callTool('x', {})).rejects.toMatchObject({
    code: 'network',
  });
});
it('reports rate limits and retry delay', async () => {
  await expect(
    client(
      vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '30' } })),
    ).callTool('x', {}),
  ).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 30 });
});
it('reports invalid input', async () => {
  await expect(
    client(vi.fn().mockResolvedValue(new Response('{}', { status: 400 }))).callTool('x', {}),
  ).rejects.toMatchObject({ code: 'invalid_input' });
});
it('distinguishes a rejected SSO session from a locally signed-out user', async () => {
  await expect(
    client(vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))).listTools(),
  ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
});
it('requires configuration', async () => {
  await expect(client(vi.fn(), '').callTool('x', {})).rejects.toMatchObject({ code: 'not_configured' });
});
it('checks public health and validates the response', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  expect(await client(fetcher, undefined, null).health()).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledWith('https://example.test/health', undefined);
  await expect(client(vi.fn().mockResolvedValue(new Response('{}'))).health()).rejects.toMatchObject({
    code: 'failed',
  });
});
it('lists authenticated tools and rejects malformed schemas', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ tools: [{ name: 'x', description: 'X', input_schema: {} }] })),
    );
  expect(await client(fetcher).listTools()).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledWith('https://example.test/v1/tools', {
    headers: { Authorization: 'Bearer token' },
  });
  await expect(
    client(
      vi.fn().mockResolvedValue(new Response('{"tools":[{"name":"x","description":"x","input_schema":[]}]}')),
    ).listTools(),
  ).rejects.toMatchObject({ code: 'failed' });
  await expect(client(vi.fn(), undefined, null).listTools()).rejects.toMatchObject({ code: 'signed_out' });
});
