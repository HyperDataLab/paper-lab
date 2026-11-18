import { expect, it, vi } from 'vitest';
import { NLP_MAX_BYTES, NLP_MAX_SENTENCES, NLP_PATH, parseNlp } from './nlp';

const json = (status: number, value: unknown, extra: Record<string, string> = {}) =>
  Response.json(value, { status, headers: extra });
const request = (body: unknown, method = 'POST') =>
  new Request(`https://test${NLP_PATH}`, {
    method,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
const ok = { sentences: [{ key: 's1', text: 'We ran it.' }] };
const sleep = async () => {};

it('forwards a valid batch to the container and returns its answer', async () => {
  const container = vi.fn(async () => Response.json({ version: 'pl-nlp-1', sentences: [] }));
  const response = await parseNlp(request(ok), container, json, sleep);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ version: 'pl-nlp-1', sentences: [] });
  expect(container).toHaveBeenCalledWith(NLP_PATH, expect.objectContaining({ method: 'POST' }));
});

it('rejects bad requests before waking the container', async () => {
  const container = vi.fn(async () => Response.json({}));
  expect((await parseNlp(request(ok, 'GET'), container, json, sleep)).status).toBe(405);
  expect((await parseNlp(request('{'), container, json, sleep)).status).toBe(400);
  for (const body of [
    {},
    { sentences: [] },
    { sentences: [{ key: 's1', text: ' ' }] },
    { sentences: [{ key: '', text: 'A.' }] },
    {
      sentences: [
        { key: 'a', text: 'A.' },
        { key: 'a', text: 'B.' },
      ],
    },
    { sentences: Array.from({ length: NLP_MAX_SENTENCES + 1 }, (_, i) => ({ key: `s${i}`, text: 'A.' })) },
  ])
    expect((await parseNlp(request(body), container, json, sleep)).status).toBe(400);
  const big = { sentences: [{ key: 's1', text: 'a'.repeat(NLP_MAX_BYTES) }] };
  expect((await parseNlp(request(big), container, json, sleep)).status).toBe(413);
  expect(container).not.toHaveBeenCalled();
});

it('waits for a starting container, then asks the client to retry', async () => {
  const starting = vi.fn(async () => new Response('Container is starting', { status: 500 }));
  const response = await parseNlp(request(ok), starting, json, sleep);
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('10');
  expect(starting).toHaveBeenCalledTimes(4);
  let calls = 0;
  const warms = vi.fn(async () =>
    ++calls < 2 ? new Response('Container is starting') : Response.json({ sentences: [] }),
  );
  expect((await parseNlp(request(ok), warms, json, sleep)).status).toBe(200);
});
