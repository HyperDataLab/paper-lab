/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, onTestFinished } from 'vitest';
import { handle, refreshJob, type Deps } from './app';

const id = '00000000-0000-4000-8000-000000000001';
const control = '00000000-0000-4000-8000-000000000002';
const job = '00000000-0000-4000-8000-000000000003';
const path = `/corpora/${id}/topics`;
const response = (value: unknown, status = 200) => Response.json(value, { status });
function setup() {
  // The deployment workflow installs Vitest in topics-worker only.
  const sqlite = new DatabaseSync(':memory:');
  onTestFinished(() => sqlite.close());
  const migrations = new URL('../../worker/migrations-data/', import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
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
    data: {
      prepare: (sql) => ({
        bind: (id) => ({
          first: async <T>() => (sqlite.prepare(sql).get(id) as T | undefined) ?? null,
        }),
      }),
    },
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
    addCorpusRow(
      corpusId: string,
      inline: string | null,
      key: string | null,
      deletedAt: string | null = null,
    ) {
      sqlite
        .prepare(
          `INSERT INTO doc (
          collection, id, version, body_json, r2_key, deleted_at, size, sha256,
          created_by, created_at, updated_by, updated_at, lab_id
        ) VALUES ('corpora', ?, 1, ?, ?, ?, 0, '', 'test', '', 'test', '', 'lab')`,
        )
        .run(corpusId, inline, key, deletedAt);
    },
    setState: (value: unknown) => {
      state = value;
    },
    setResult: (value: unknown) => {
      result = value;
    },
  };
}
it('runs topics over current R2 and inline corpus bodies rather than legacy copies', async () => {
  const t = setup();
  const key = `paperlab/data/corpora/${id}/v2.json`;
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, title: 'Legacy corpus', members: [] }));
  t.addCorpusRow(id, null, key);
  t.values.set(
    key,
    JSON.stringify({ id, kind: 'journal', title: 'Edited corpus', members: [{ memberId: 'new-member' }] }),
  );
  t.addCorpusRow(
    control,
    JSON.stringify({ id: control, kind: 'control', title: 'Inline control', members: [] }),
    null,
  );
  t.deps.container = async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({
      corpora: [
        { corpusId: id, title: 'Edited corpus' },
        { corpusId: control, title: 'Inline control' },
      ],
      members: [{ corpusId: id, memberId: 'new-member' }],
    });
    return response({ jobId: job }, 202);
  };
  expect((await t.request('POST', '/run', { controlIds: [control] })).status).toBe(202);
});

it.each([
  { name: 'invalid', inline: '{}', key: null, deletedAt: null, status: 400 },
  { name: 'missing its body', inline: null, key: 'paperlab/data/missing', deletedAt: null, status: 404 },
  { name: 'deleted', inline: null, key: null, deletedAt: '2026-11-20T00:00:00Z', status: 404 },
])('gives the central row precedence when it is $name', async ({ inline, key, deletedAt, status }) => {
  const t = setup();
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, kind: 'journal', members: [] }));
  t.addCorpusRow(id, inline, key, deletedAt);
  expect((await t.request('POST', '/run', {})).status).toBe(status);
});

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
