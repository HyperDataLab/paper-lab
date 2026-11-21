import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const base = new URL(process.env.PAPERLAB_DATA_URL ?? 'https://paperlab-pdf-worker.hyperdatalab.workers.dev');
const token = process.env.PAPERLAB_DATA_TOKEN;
const samples = Number(process.env.PAPERLAB_DATA_SAMPLES ?? 20);
if (!token) throw new Error('Set PAPERLAB_DATA_TOKEN to a current PaperLab ID token.');
if (base.protocol !== 'https:') throw new Error('Use an HTTPS worker URL.');
if (!Number.isSafeInteger(samples) || samples < 1)
  throw new Error('PAPERLAB_DATA_SAMPLES must be a positive integer.');

const collection = 'extractionProjects';
const fixtureIds = new Set();
const paperId = randomUUID();
const url = (path) => new URL(`/v1/data/${path}`, base);
const document = (id) => `${collection}/${id}`;

async function request(path, { method = 'GET', body, headers, missingOk = false } = {}) {
  const response = await fetch(url(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && !(missingOk && response.status === 404))
    throw new Error(`${method} ${path} returned HTTP ${response.status}.`);
  return { data: await response.json(), etag: response.headers.get('ETag'), status: response.status };
}

function fixture(id, bytes) {
  const at = new Date().toISOString();
  const value = {
    schemaVersion: 1,
    id,
    paperId,
    title: 'PaperLab latency probe',
    researchQuestion: '',
    createdAt: at,
    updatedAt: at,
    papers: [],
    fields: [],
    runs: [],
    cells: [],
    deep: null,
  };
  value.researchQuestion = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(value)));
  return value;
}

async function create(bytes) {
  const id = randomUUID();
  fixtureIds.add(id);
  const body = fixture(id, bytes);
  const saved = await request(document(id), { method: 'PUT', body, headers: { 'If-None-Match': '*' } });
  return { id, body, version: saved.data.version, etag: saved.etag };
}

async function measure(label, run) {
  const times = [];
  await run();
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.ceil(times.length * q) - 1].toFixed(1);
  console.log(`${label.padEnd(26)} p50 ${p(0.5)} ms  p95 ${p(0.95)} ms  n=${times.length}`);
}

async function remove(id) {
  const { etag, status } = await request(document(id), { missingOk: true });
  if (status !== 404) await request(document(id), { method: 'DELETE', headers: { 'If-Match': etag } });
  fixtureIds.delete(id);
}

try {
  for (const mb of [0.1, 1, 5]) {
    const entry = await create(mb * 1_000_000);
    const list = (include) =>
      request('query', {
        method: 'POST',
        body: { collection, where: { paperId }, limit: 1, include },
      });
    await measure(`list summary (${mb} MB)`, () => list('summary'));
    await measure(`list body (${mb} MB)`, () => list('body'));
    await measure(`get (${mb} MB)`, () => request(document(entry.id)));
    await measure(`put (${mb} MB)`, async () => {
      entry.body.updatedAt = new Date().toISOString();
      const result = await request(document(entry.id), {
        method: 'PUT',
        headers: { 'If-Match': entry.etag },
        body: entry.body,
      });
      entry.etag = result.etag;
    });
    await remove(entry.id);
  }
  const guard = await create(100_000);
  const entry = await create(1_000_000);
  await measure('commit (1 MB + guard)', async () => {
    entry.body.updatedAt = new Date().toISOString();
    const { data } = await request('commit', {
      method: 'POST',
      body: {
        guards: [{ collection, id: guard.id, expectedVersion: guard.version }],
        ops: [{ collection, id: entry.id, op: 'put', expectedVersion: entry.version, body: entry.body }],
      },
    });
    entry.version = data.results[0].version;
  });
} finally {
  const remaining = [...fixtureIds];
  const cleanup = await Promise.allSettled(remaining.map(remove));
  for (const [index, result] of cleanup.entries()) {
    if (result.status === 'rejected') {
      console.error(`Could not remove latency probe ${remaining[index]}: ${result.reason.message}`);
      process.exitCode = 1;
    }
  }
}
