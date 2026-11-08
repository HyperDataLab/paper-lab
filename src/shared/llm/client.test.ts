import { z } from 'zod';
import { createLlmClient } from './client';
import { defaultConfig, getConfig, type LlmConfig } from './config';
import { acceptConsent, hasValidConsent, revokeConsent } from './consent';
import { createGatedClient } from './gatedClient';
import {
  ConsentRequiredError,
  InvalidModelOutputError,
  LlmConfigError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
} from './errors';

const schema = z.object({ ok: z.literal(true), model: z.string() });
const options = { system: 'system', user: 'user', schema, schemaName: 'test', promptVersion: 'v1' };
const config = { baseUrl: '/llm', model: 'test' };
const response = (content: string, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers });
const valid = '{"ok":true,"model":"test"}';
function setup(responses: Response[], settings: LlmConfig = config) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => responses.shift() ?? response(valid));
  const sleep = vi.fn(async (_ms: number) => {});
  return { fetchMock, sleep, client: createLlmClient(settings, { fetch: fetchMock, sleep, now: () => 0 }) };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it.each(['```json\n' + valid + '\n```', 'Here is the result: ' + valid + ' Done.'])(
  'ADR-0003 parses wrapped JSON without repair: %s',
  async (content) => {
    const { client, fetchMock } = setup([response(content)]);
    expect((await client.completeJson(options)).meta.repaired).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
it('ADR-0003 retries network failures twice and reports a network error', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createLlmClient(config, { fetch: fetchMock, sleep, now: () => 0 });
  await expect(client.completeJson(options)).rejects.toBeInstanceOf(LlmNetworkError);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
});
it('ADR-0003 caller abort returns AbortError without retry', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
    controller.abort();
    throw new Error('aborted');
  });
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createLlmClient(config, { fetch: fetchMock, sleep, now: () => 0 });
  await expect(client.completeJson({ ...options, signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});
it('PRD §9 Privacy handles inaccessible storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(hasValidConsent(config)).toBe(false);
  expect(acceptConsent(config)).toBeNull();
  expect(getConfig()).toEqual(defaultConfig());
});
it('PRD §9 Privacy never exposes a key in console calls or a failing request error', async () => {
  const key = 'fake-private-key-987654';
  const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(`failed ${key}`));
  const client = createLlmClient(
    { ...config, baseUrl: 'https://router.example', key },
    {
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
    },
  );
  const error: unknown = await client.completeJson(options).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LlmNetworkError);
  expect((error as Error).message).not.toContain(key);
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(key);
});
it('ADR-0003 sends schema twice and omits proxy authorization', async () => {
  const { client, fetchMock } = setup([response('```json\n' + valid + '\n```')]);
  await client.completeJson(options);
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.headers).not.toHaveProperty('Authorization');
  const body = JSON.parse(String(init?.body));
  expect(body.response_format.json_schema.schema.properties.ok).toBeDefined();
  expect(body.messages[0].content).toContain('"properties"');
});
it('ADR-0003 requires a key for direct HTTPS and rejects insecure HTTP', async () => {
  const direct = setup([response('prose ' + valid)], {
    ...config,
    baseUrl: 'https://router.example',
    key: 'secret',
  });
  await direct.client.completeJson(options);
  expect(direct.fetchMock.mock.calls[0]?.[1]?.headers).toHaveProperty('Authorization', 'Bearer secret');
  const missing = setup([], { ...config, baseUrl: 'https://router.example' });
  await expect(missing.client.completeJson(options)).rejects.toBeInstanceOf(LlmConfigError);
  await expect(
    setup([], { ...config, baseUrl: 'http://example.com' }).client.completeJson(options),
  ).rejects.toBeInstanceOf(LlmConfigError);
  expect(missing.fetchMock).not.toHaveBeenCalled();
});
it('repairs invalid output once with validation issues and redacts failures', async () => {
  const consoleSpy = vi.spyOn(console, 'error');
  const fixed = setup([response('{"ok":false}'), response(valid)]);
  expect((await fixed.client.completeJson(options)).meta.repaired).toBe(true);
  expect(String(fixed.fetchMock.mock.calls[1]?.[1]?.body)).toContain('validation issues');
  const failed = setup([response('secret'.repeat(100)), response('secret'.repeat(100))], {
    ...config,
    baseUrl: 'https://router.example',
    key: 'secret',
  });
  const error = await failed.client.completeJson(options).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InvalidModelOutputError);
  expect((error as InvalidModelOutputError).rawSnippet.length).toBeLessThanOrEqual(300);
  expect((error as InvalidModelOutputError).rawSnippet).not.toContain('secret');
  expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('secret');
  consoleSpy.mockRestore();
});
it('retries 429 with Retry-After and does not retry 401', async () => {
  const retry = setup([response('', 429, { 'Retry-After': '1' }), response(valid)]);
  await retry.client.completeJson(options);
  expect(retry.sleep).toHaveBeenCalledWith(1000);
  const denied = setup([response('', 401)]);
  await expect(denied.client.completeJson(options)).rejects.toMatchObject({ status: 401, retryable: false });
  expect(denied.fetchMock).toHaveBeenCalledTimes(1);
  expect(new LlmHttpError(401, false)).toBeInstanceOf(Error);
});
it('P2 invokes the request hook before retries and repair, and stops before a refused request', async () => {
  const t = setup([response('', 429), response('bad'), response(valid)]);
  let used = 0;
  const onRequest = vi.fn(async () => {
    if (used === 2) throw new Error('budget');
    used++;
  });
  await expect(t.client.completeJson({ ...options, onRequest })).rejects.toThrow('budget');
  expect(onRequest).toHaveBeenCalledTimes(3);
  expect(t.fetchMock).toHaveBeenCalledTimes(2);
});
it('times out', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
  const promise = createLlmClient(config, {
    fetch: fetchMock,
    sleep: async () => {},
    now: () => 0,
  }).completeJson(options);
  const assertion = expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
  await vi.advanceTimersByTimeAsync(60000);
  await assertion;
  vi.useRealTimers();
});
it('PRD §9 Privacy gates requests and invalidates changed endpoints and versions', async () => {
  const { client, fetchMock } = setup([response(valid)]);
  const gated = createGatedClient(config, client);
  expect(() => gated.completeJson(options)).toThrow(ConsentRequiredError);
  expect(fetchMock).not.toHaveBeenCalled();
  acceptConsent(config);
  expect(hasValidConsent(config)).toBe(true);
  expect(hasValidConsent({ ...config, baseUrl: '/other' })).toBe(false);
  const record = JSON.parse(localStorage.getItem('pl.consent') || '{}');
  localStorage.setItem('pl.consent', JSON.stringify({ ...record, version: 0 }));
  expect(hasValidConsent(config)).toBe(false);
  acceptConsent(config);
  revokeConsent();
  expect(hasValidConsent(config)).toBe(false);
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error();
  });
  expect(hasValidConsent(config)).toBe(false);
  spy.mockRestore();
});
