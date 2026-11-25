/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, onTestFinished } from 'vitest';
import { handle, refreshJob, type Deps } from './app';

const id = '00000000-0000-4000-8000-000000000001';
const control = '00000000-0000-4000-8000-000000000002';
const job = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000004';
const path = `/corpora/${id}/topics`;
const response = (value: unknown, status = 200) => Response.json(value, { status });
const validMembers = () =>
  Array.from({ length: 6 }, (_, index) => ({
    memberId: `member-${index}`,
    title: `Research paper ${index}`,
    identifiers: { doi: null, openalexId: null },
  }));
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
        bind: (...values) => ({
          first: async <T>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
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
    getOwnedProject: async (requestedId) => ({ id: requestedId, name: 'Test project' }),
    container: async (url) =>
      url === '/jobs'
        ? response({ jobId: job }, 202)
        : url.endsWith('/result')
          ? response(result)
          : response(state),
  };
  const request = (method: string, suffix = '', body?: unknown, token = 'Bearer test', scope?: string) => {
    const url = new URL(`https://test${path}${suffix}`);
    if (scope) url.searchParams.set('projectId', scope);
    return handle(
      new Request(url, {
        method,
        headers: {
          authorization: token,
          origin: 'https://test',
          ...(scope ? { 'x-project-id': scope } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      deps,
    );
  };
  return {
    values,
    deps,
    request,
    addCorpusRow(
      corpusId: string,
      inline: string | null,
      key: string | null,
      deletedAt: string | null = null,
      scope: string | null = null,
    ) {
      const physicalId = scope ? `@rh/${scope}/${corpusId}` : corpusId;
      sqlite
        .prepare(
          `INSERT INTO doc (
          collection, id, version, body_json, r2_key, deleted_at, size, sha256,
          created_by, created_at, updated_by, updated_at, lab_id, hub_project_id
        ) VALUES ('corpora', ?, 1, ?, ?, ?, 0, '', 'test', '', 'test', '', 'lab', ?)`,
        )
        .run(physicalId, inline, key, deletedAt, scope);
    },
    setState: (value: unknown) => {
      state = value;
    },
    setResult: (value: unknown) => {
      result = value;
    },
  };
}

it('loads and stores topic results inside the authorized ResearchHub project scope', async () => {
  const t = setup();
  t.addCorpusRow(
    id,
    JSON.stringify({ id, kind: 'journal', title: 'Project corpus', members: validMembers() }),
    null,
    null,
    projectId,
  );
  t.deps.container = async (url) =>
    url === '/jobs'
      ? response({ jobId: job }, 202)
      : url.endsWith('/result')
        ? response({
            format: 'paperlab-corpus-topics',
            schemaVersion: 1,
            snapshotId: 's',
            corpora: [{ corpusId: id }],
            members: [],
            topics: [],
          })
        : response({ state: 'done', progress: 'Complete' });

  const started = await t.request('POST', '/run', {}, 'Bearer test', projectId);
  expect(started.status).toBe(202);
  expect(t.values.get(`paperlab/corpora-topics/jobs/${job}.json`)).toContain(`"projectId":"${projectId}"`);

  await refreshJob(t.deps.bucket, t.deps.container, job);
  t.setState({ state: 'done' });
  await refreshJob(t.deps.bucket, t.deps.container, job);
  expect(t.values.has(`paperlab/projects/${projectId}/corpora-topics/${id}.json`)).toBe(true);
  expect((await t.request('GET', '', undefined, 'Bearer test', projectId)).status).toBe(200);
  expect((await t.request('GET')).status).toBe(404);
});

it('does not read a project corpus from the unscoped lab store or legacy R2 key', async () => {
  const t = setup();
  t.addCorpusRow(id, JSON.stringify({ id, kind: 'journal', members: validMembers() }), null);
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, kind: 'journal', members: validMembers() }));
  expect((await t.request('POST', '/run', {}, 'Bearer test', projectId)).status).toBe(404);
});

it('rejects a project request when the signed-in user cannot access that project', async () => {
  const t = setup();
  let containerCalled = false;
  t.deps.getOwnedProject = async () => null;
  t.deps.container = async () => {
    containerCalled = true;
    return response({ jobId: job }, 202);
  };
  expect((await t.request('POST', '/run', {}, 'Bearer test', projectId)).status).toBe(404);
  expect(containerCalled).toBe(false);
});
it('rejects conflicting project scope in the query and header', async () => {
  const t = setup();
  const request = new Request(`https://test${path}/run?projectId=${projectId}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test',
      'x-project-id': control,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  expect((await handle(request, t.deps)).status).toBe(400);
});
it('runs topics over current R2 and inline corpus bodies rather than legacy copies', async () => {
  const t = setup();
  const key = `paperlab/data/corpora/${id}/v2.json`;
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, title: 'Legacy corpus', members: [] }));
  t.addCorpusRow(id, null, key);
  t.values.set(key, JSON.stringify({ id, kind: 'journal', title: 'Edited corpus', members: validMembers() }));
  t.addCorpusRow(
    control,
    JSON.stringify({ id: control, kind: 'control', title: 'Inline control', members: [] }),
    null,
  );
  let sentPayload: unknown;
  t.deps.container = async (_url, init) => {
    sentPayload = JSON.parse(String(init?.body));
    return response({ jobId: job }, 202);
  };
  expect((await t.request('POST', '/run', { controlIds: [control] })).status).toBe(202);
  expect(sentPayload).toMatchObject({
    corpora: [
      { corpusId: id, title: 'Edited corpus' },
      { corpusId: control, title: 'Inline control' },
    ],
  });
  expect(sentPayload).toMatchObject({
    members: expect.arrayContaining([expect.objectContaining({ corpusId: id, memberId: 'member-0' })]),
  });
});

it('rejects corpora with fewer than six usable papers before waking the model container', async () => {
  const t = setup();
  t.values.set(
    `paperlab/corpora/${id}`,
    JSON.stringify({
      id,
      kind: 'journal',
      members: validMembers().slice(0, 5),
    }),
  );
  const result = await t.request('POST', '/run', {});
  expect(result.status).toBe(422);
  expect(await result.json()).toMatchObject({ error: expect.stringContaining('At least 6 papers') });
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
      JSON.stringify({ id: corpusId, title: 'test', kind, members: validMembers() }),
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
  t.values.set(`paperlab/corpora/${id}`, JSON.stringify({ id, kind: 'journal', members: validMembers() }));
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
