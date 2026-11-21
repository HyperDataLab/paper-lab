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
it('ADR-0003 asks for a non-streamed answer', async () => {
  const { client, fetchMock } = setup([response(valid)]);
  await client.completeJson(options);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ stream: false });
});
it('ADR-0003 joins server-sent chunks that a router returns without being asked to stream', async () => {
  const chunks = [
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { reasoning_content: 'thinking…' } }] },
    { choices: [{ delta: { content: '```json\n{"ok":tr' } }] },
    { choices: [{ delta: { content: 'ue,"model":"test"}\n```' } }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 5 } },
  ];
  const sse = `${chunks.map((c) => `data: ${JSON.stringify(c)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  const { client, fetchMock } = setup([
    new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }),
  ]);
  const result = await client.completeJson(options);
  expect(result.data).toEqual({ ok: true, model: 'test' });
  expect(result.meta).toMatchObject({ repaired: false, usage: { prompt_tokens: 3, completion_tokens: 5 } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('ADR-0003 joins streamed tool-call arguments', async () => {
  const part = (args: string) => ({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }],
  });
  const sse = [part('{"ok":true,'), part('"model":"test"}')]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join('');
  const { client } = setup([new Response(sse)]);
  expect((await client.completeJson(options)).data).toEqual({ ok: true, model: 'test' });
});
it('ADR-0003 does not echo an empty answer back as an assistant turn', async () => {
  const { client, fetchMock } = setup([response('')]);
  await client.completeJson(options);
  const retry = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { messages: { role: string }[] };
  expect(retry.messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
});
const body = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
it.each([
  ['a JSON object as content', { content: { ok: true, model: 'test' } }],
  ['text content blocks', { content: [{ type: 'text', text: valid }] }],
  ['a tool-call arguments string', { content: null, tool_calls: [{ function: { arguments: valid } }] }],
  ['a legacy function_call', { content: '', function_call: { arguments: valid } }],
])('ADR-0003 reads %s without repair', async (_label, message) => {
  const { client, fetchMock } = setup([body(message)]);
  const result = await client.completeJson(options);
  expect(result.data).toEqual({ ok: true, model: 'test' });
  expect(result.meta.repaired).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('ADR-0003 still validates tool-call arguments against the schema', async () => {
  const { client, fetchMock } = setup([
    body({ tool_calls: [{ function: { arguments: '{"ok":false}' } }] }),
    body({ tool_calls: [{ function: { arguments: valid } }] }),
  ]);
  expect((await client.completeJson(options)).meta.repaired).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('ADR-0003 reports the structure of a streamed answer that stays invalid, with secrets redacted', async () => {
  const key = 'sk-test-secret-123';
  const sse = (args: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })}\n\ndata: [DONE]\n\n`,
    );
  const { client, fetchMock } = setup([sse(`{"ok":"${key}"}`), sse(`{"ok":"${key}"}`)], {
    ...config,
    baseUrl: 'https://router.example',
    key,
  });
  const error: unknown = await client.completeJson(options).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InvalidModelOutputError);
  const invalid = error as InvalidModelOutputError;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(invalid.details).toEqual({
    responseFormat: 'json_schema',
    streamed: true,
    envelope: 'chat_completion',
    source: 'tool_call',
    rawLength: `{"ok":"${key}"}`.length,
  });
  expect(invalid.rawSnippet).toContain('[redacted]');
  expect(
    JSON.stringify([invalid.issues, invalid.rawSnippet, invalid.details, invalid.message]),
  ).not.toContain(key);
});
it('ADR-0003 reports an unparseable body as such', async () => {
  const { client } = setup([new Response('<html>oops</html>'), new Response('<html>oops</html>')]);
  const error = (await client.completeJson(options).catch((e: unknown) => e)) as InvalidModelOutputError;
  expect(error).toBeInstanceOf(InvalidModelOutputError);
  expect(error.details).toMatchObject({ envelope: 'unparseable', source: 'none', rawLength: 0 });
  expect(error.issues).toBe('The response had no JSON text or tool arguments.');
});
it('ADR-0003 downgrades a rejected response_format without using up the repair round', async () => {
  const rejected = () => new Response('response_format json_schema is not supported', { status: 400 });
  const { client, fetchMock } = setup([rejected(), rejected(), response('{"ok":false}'), response(valid)]);
  const result = await client.completeJson(options);
  expect(result.meta.repaired).toBe(true);
  const formats = fetchMock.mock.calls.map(
    (call) =>
      (JSON.parse(String(call[1]?.body)) as { response_format?: { type: string } }).response_format?.type,
  );
  expect(formats).toEqual(['json_schema', 'json_object', undefined, undefined]);
});
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
  expect(String(fixed.fetchMock.mock.calls[1]?.[1]?.body)).toContain('Validation issues');
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
