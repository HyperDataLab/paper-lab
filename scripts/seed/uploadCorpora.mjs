import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error('usage: node scripts/seed/uploadCorpora.mjs <outDir>');
const token = process.env.PAPERLAB_DATA_TOKEN;
if (!token) throw new Error('Set PAPERLAB_DATA_TOKEN to a current PaperLab ID token.');
const base = 'https://paperlab-pdf-worker.hyperdatalab.workers.dev';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const files = (await readdir(outDir)).filter(
  (file) => uuid.test(file.slice(0, -5)) && file.endsWith('.json'),
);
if (!files.length) throw new Error(`No corpus JSON files in ${outDir}`);

const corpora = [];
for (const file of files) {
  const id = file.slice(0, -5);
  const body = await readFile(join(outDir, file));
  const corpus = JSON.parse(body.toString('utf8'));
  if (corpus.id !== id || corpus.format !== 'paperlab-corpus' || corpus.schemaVersion !== 1)
    throw new Error(`Invalid corpus file: ${file}`);
  corpora.push({ id, body });
}

function existsInR2(id) {
  const args = [
    '--no-install',
    'wrangler@4.161.0',
    'r2',
    'object',
    'get',
    `paper-fetch/paperlab/corpora/${id}`,
    '--remote',
    '--pipe',
    '--config',
    'worker/wrangler.toml',
  ];
  // The Windows command line contains only fixed arguments and a validated UUID.
  const options = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/c', 'npx', ...args], options)
      : spawnSync('npx', args, options);
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (/The specified key does not exist\./u.test(`${result.stderr}\n${result.stdout}`)) return false;
  throw new Error(`Wrangler could not check ${id}: ${result.stderr.trim()}`);
}

for (const { id, body } of corpora) {
  if (existsInR2(id)) {
    console.log(`Exists: ${id}`);
    continue;
  }
  // The legacy worker adds the corpus metadata and makes the R2 create-only write atomic.
  const result = await fetch(`${base}/corpora/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-None-Match': '*' },
    redirect: 'error',
    body,
  });
  if (result.status === 409) console.log(`Exists: ${id}`);
  else if (result.status === 201) console.log(`Created: ${id}`);
  else throw new Error(`Create ${id} returned HTTP ${result.status}`);
}
