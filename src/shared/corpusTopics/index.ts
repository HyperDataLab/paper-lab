import { z } from 'zod';
import { CorpusTopicsSchema } from '@/core/schemas/corpusTopics';

/**
 * The topics worker (BERTopic). Corpora themselves are documents in the central lab store (ADR-0007); the former
 * R2 + ETag corpus sync is gone.
 */
export const TOPICS_WORKER_URL: string =
  (import.meta.env.VITE_TOPICS_WORKER_URL as string | undefined) ||
  'https://paperlab-topics-worker.hyperdatalab.workers.dev';

async function checked(response: Response) {
  if (!response.ok) throw new Error(`Dịch vụ chủ đề trả lời HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
export async function pullCorpusTopics(id: string, token: string) {
  const response = await fetch(`${TOPICS_WORKER_URL}/corpora/${encodeURIComponent(id)}/topics`, {
    headers: headers(token),
  });
  if (response.status === 404) return undefined;
  const snapshot = CorpusTopicsSchema.parse(await checked(response));
  if (!snapshot.corpora.some((corpus) => corpus.corpusId === id))
    throw new Error('Corpus không khớp định danh');
  return snapshot;
}

export async function startCorpusTopics(
  id: string,
  token: string,
  controlIds: string[],
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  // The server answers 503 while its container starts; keep asking for about two minutes.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${TOPICS_WORKER_URL}/corpora/${encodeURIComponent(id)}/topics/run`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ controlIds }),
    });
    if (response.status === 503 && attempt < 5) {
      const after = Number(response.headers.get('Retry-After')) || 20;
      await wait(Math.min(after, 30) * 1000);
      continue;
    }
    return z.object({ jobId: z.string() }).parse(await checked(response)).jobId;
  }
}
export async function corpusTopicsStatus(id: string, jobId: string, token: string) {
  const response = await fetch(
    `${TOPICS_WORKER_URL}/corpora/${encodeURIComponent(id)}/topics/run/${encodeURIComponent(jobId)}`,
    { headers: headers(token) },
  );
  return z
    .object({
      state: z.enum(['queued', 'running', 'done', 'failed']),
      progress: z.string().optional(),
      error: z.string().optional(),
      snapshotId: z.string().optional(),
    })
    .parse(await checked(response));
}
