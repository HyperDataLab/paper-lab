import { z } from 'zod';
import { CorpusSchema, type Corpus } from '@/core/schemas/corpus';
import { CorpusTopicsSchema } from '@/core/schemas/corpusTopics';
import { PDF_WORKER_URL } from '@/shared/pdfStore';

const entry = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  updatedAt: z.iso.datetime(),
  version: z.string(),
});
const result = z.object({ corpus: CorpusSchema, version: z.string() });
export class CorpusConflict extends Error {
  constructor(public version: string | null) {
    super('Corpus đã được người khác sửa');
  }
}
async function checked(response: Response) {
  if (response.status === 409) {
    const body = z.object({ version: z.string().nullable() }).parse(await response.json());
    throw new CorpusConflict(body.version);
  }
  if (!response.ok) throw new Error(`Đồng bộ corpus thất bại (${response.status})`);
  return response.json() as Promise<unknown>;
}
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
export async function pullCorpusTopics(id: string, token: string) {
  const response = await fetch(`${PDF_WORKER_URL}/corpora/${encodeURIComponent(id)}/topics`, {
    headers: headers(token),
  });
  if (response.status === 404) return undefined;
  const snapshot = CorpusTopicsSchema.parse(await checked(response));
  if (!snapshot.corpora.some((corpus) => corpus.corpusId === id))
    throw new Error('Corpus không khớp định danh');
  return snapshot;
}
export async function pullCorpora(token: string) {
  return z
    .array(entry)
    .parse(await checked(await fetch(`${PDF_WORKER_URL}/corpora`, { headers: headers(token) })));
}
export async function pullCorpus(id: string, token: string) {
  const value = result.parse(
    await checked(
      await fetch(`${PDF_WORKER_URL}/corpora/${encodeURIComponent(id)}`, { headers: headers(token) }),
    ),
  );
  if (value.corpus.id !== id) throw new Error('Corpus không khớp định danh');
  return value;
}
export async function pushCorpus(corpus: Corpus, knownVersion: string | null, token: string) {
  const value = CorpusSchema.parse(corpus);
  const response = await fetch(`${PDF_WORKER_URL}/corpora/${encodeURIComponent(value.id)}`, {
    method: 'PUT',
    headers: {
      ...headers(token),
      'Content-Type': 'application/json',
      ...(knownVersion === null ? { 'If-None-Match': '*' } : { 'If-Match': knownVersion }),
    },
    body: JSON.stringify(value),
  });
  return z.object({ version: z.string() }).parse(await checked(response)).version;
}
