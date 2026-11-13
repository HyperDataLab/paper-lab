import { expect, it } from 'vitest';
import { handle, type Deps } from './app';

const id = '00000000-0000-4000-8000-000000000001';
const control = '00000000-0000-4000-8000-000000000002';
const job = '00000000-0000-4000-8000-000000000003';
const path = `/corpora/${id}/topics`;
const response = (value: unknown, status = 200) => Response.json(value, { status });
function setup() {
  const values = new Map<string, string>();
  let state: unknown = { state: 'running', progress: 'Embedding' };
  let result: unknown = {
    format: 'paperlab-corpus-topics',
    schemaVersion: 1,
    snapshotId: 's',
    corpora: [{ corpusId: id }, { corpusId: control }],
  };
  const deps: Deps = {
    bucket: {
      get: async (key) => (values.has(key) ? { body: new Blob([values.get(key) ?? '']).stream() } : null),
      put: async (key, value) => {
        values.set(key, value);
      },
    },
    origins: ['https://test'],
    verify: async () => ({}),
    container: async (url) =>
      url === '/jobs'
        ? response({ jobId: job }, 202)
        : url.endsWith('/result')
          ? response(result)
          : response(state),
  };
  const request = (method: string, suffix = '', body?: unknown, token = 'Bearer test') =>
    handle(
      new Request(`https://test${path}${suffix}`, {
        method,
        headers: { authorization: token, origin: 'https://test' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      deps,
    );
  return {
    values,
    request,
    setState: (value: unknown) => {
      state = value;
    },
    setResult: (value: unknown) => {
      result = value;
    },
  };
}
it('authenticates requests, starts jobs and stores validated completed results for both corpora', async () => {
  const t = setup();
  expect((await t.request('GET', '', undefined, '')).status).toBe(401);
  expect((await t.request('POST', '/run', {})).status).toBe(404);
  for (const [corpusId, kind] of [
    [id, 'journal'],
    [control, 'control'],
  ])
    t.values.set(
      `paperlab/corpora/${corpusId}`,
      JSON.stringify({ id: corpusId, title: 'test', kind, members: [] }),
    );
  expect((await t.request('POST', '/run', { controlIds: [control] })).status).toBe(202);
  expect(await (await t.request('GET', `/run/${job}`)).json()).toEqual({
    state: 'running',
    progress: 'Embedding',
  });
  t.setState({ state: 'done' });
  t.setResult({ format: 'wrong', schemaVersion: 1 });
  expect((await t.request('GET', `/run/${job}`)).status).toBe(502);
  t.setResult({
    format: 'paperlab-corpus-topics',
    schemaVersion: 1,
    snapshotId: 's',
    corpora: [{ corpusId: id }, { corpusId: control }],
  });
  expect(await (await t.request('GET', `/run/${job}`)).json()).toEqual({ state: 'done', snapshotId: 's' });
  expect(t.values.has(`paperlab/corpora-topics/${control}.json`)).toBe(true);
  expect((await t.request('GET')).status).toBe(200);
});
