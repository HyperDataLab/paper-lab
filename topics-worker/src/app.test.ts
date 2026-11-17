import { expect, it } from 'vitest';
import { handle, refreshJob, type Deps } from './app';

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
    members: [],
    topics: [],
  };
  const deps: Deps = {
    bucket: {
      get: async (key) => (values.has(key) ? { body: new Blob([values.get(key) ?? '']).stream() } : null),
      put: async (key, value) => {
        values.set(key, value);
      },
    },
    schedule: async () => {},
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
    deps,
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
  const key = `paperlab/corpora-topics/jobs/${job}.json`;
  expect(JSON.parse(t.values.get(key) ?? '{}')).toMatchObject({
    jobId: job,
    corpusIds: [id, control],
    state: 'queued',
  });
  await refreshJob(t.deps.bucket, t.deps.container, job);
  expect(await (await t.request('GET', `/run/${job}`)).json()).toMatchObject({
    state: 'running',
    progress: 'Embedding',
  });
  t.setState({ state: 'done' });
  await refreshJob(t.deps.bucket, t.deps.container, job);
  expect(t.values.has(`paperlab/corpora-topics/${control}.json`)).toBe(true);
  t.deps.container = async () => {
    throw new Error('gone');
  };
  expect(await (await t.request('GET', `/run/${job}`)).json()).toMatchObject({
    state: 'done',
    snapshotId: 's',
  });
  expect((await t.request('GET')).status).toBe(200);
});
it('routes POST /nlp/parse behind the same sign-in to the nlp container', async () => {
  const t = setup();
  const parse = (deps: Deps, token = 'Bearer test') =>
    handle(
      new Request('https://test/nlp/parse', {
        method: 'POST',
        headers: { authorization: token, origin: 'https://test' },
        body: JSON.stringify({ sentences: [{ key: 's1', text: 'We ran it.' }] }),
      }),
      deps,
    );
  expect((await parse(t.deps, '')).status).toBe(401);
  expect((await parse(t.deps)).status).toBe(404);
  t.deps.nlp = async () => response({ sentences: [] });
  const ok = await parse(t.deps);
  expect(ok.status).toBe(200);
  expect(ok.headers.get('access-control-allow-origin')).toBe('https://test');
  expect((await handle(new Request('https://test/nlp/other'), t.deps)).status).toBe(400);
});
it('records container failures and returns CORS on exceptions', async () => {
  const t = setup();
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, kind: 'journal', members: [] }));
  await t.request('POST', '/run', {});
  t.setState({ state: 'failed', error: 'traceback: failure' });
  await refreshJob(t.deps.bucket, t.deps.container, job);
  expect(await (await t.request('GET', `/run/${job}`)).json()).toMatchObject({
    state: 'failed',
    error: 'traceback: failure',
  });
  t.deps.bucket.get = async () => {
    throw new Error('R2 unavailable');
  };
  const response = await t.request('GET');
  expect(response.status).toBe(500);
  expect(response.headers.get('access-control-allow-origin')).toBe('https://test');
  expect(await response.json()).toHaveProperty('error');
});
