import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';

const snapshot = z.object({ url: z.string(), runAt: z.iso.datetime(), body: z.json() });

async function fetchAnonymous(url: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'paperlab-journal-seed/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
    });
    if (response.ok) return response.json();
    if (attempt === 5 || (response.status !== 429 && response.status < 500))
      throw new Error(`OpenAlex HTTP ${response.status}: ${url}`);
    await wait(Math.max(Number(response.headers.get('retry-after')) || 0, 15 * attempt) * 1000);
  }
  throw new Error(`OpenAlex retry limit reached: ${url}`);
}

/** Each successful request is saved independently so a failed fetch can resume. */
export function openAlexSnapshot(rawDir: string, fetchMissing: boolean) {
  let lastRequest = 0;
  return async (url: string) => {
    const request = new URL(url);
    if (
      request.origin !== 'https://api.openalex.org' ||
      ['mailto', 'email', 'api_key'].some((key) => request.searchParams.has(key))
    )
      throw new Error('Expected an anonymous OpenAlex request');
    const file = join(rawDir, `${createHash('sha256').update(url).digest('hex')}.json`);
    if (existsSync(file)) {
      const saved = snapshot.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (saved.url !== url) throw new Error(`Snapshot URL mismatch: ${file}`);
      return saved;
    }
    if (!fetchMissing) throw new Error(`Missing OpenAlex snapshot: ${url}`);
    await wait(Math.max(0, 4000 - (Date.now() - lastRequest)));
    console.log(`GET ${url}`);
    let body: unknown;
    try {
      body = await fetchAnonymous(url);
    } catch (error) {
      throw new Error(`OpenAlex request failed: ${url}`, { cause: error });
    } finally {
      lastRequest = Date.now();
    }
    const saved = snapshot.parse({ url, runAt: new Date().toISOString(), body });
    mkdirSync(rawDir, { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    writeFileSync(tempFile, JSON.stringify(saved));
    renameSync(tempFile, file);
    return saved;
  };
}
