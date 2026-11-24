import type { Bucket } from '../deps';
import type { D1Database, KgBindings } from '../kg/bindings';

/** The vector metadata the passage index writes; `projectId` and `paperId` have metadata indexes. */
export interface PassageVectorMetadata {
  projectId: string;
  paperId: string;
  paragraphId: string;
  sectionRole: string;
}

type Filter = Record<string, string | { $eq: string } | { $in: string[] }>;

/** The part of the `PASSAGE_VECTORS` Vectorize binding the passage index uses, so tests can fake it. */
export interface PassageVectorIndex {
  upsert(vectors: { id: string; values: number[]; metadata: PassageVectorMetadata }[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(
    vector: number[],
    options: { topK: number; filter?: Filter; returnMetadata?: 'none' },
  ): Promise<{ matches: { id: string; score: number }[] }>;
}

export interface PassageEnv {
  db: D1Database;
  bucket: Pick<Bucket, 'get'>;
  vectors: PassageVectorIndex;
  ai: NonNullable<KgBindings['AI']>;
}

/** All four bindings, or null when one is missing (the routes then answer 503 `passages_not_configured`). */
export function configuredPassages(bindings: {
  db?: D1Database;
  bucket?: Pick<Bucket, 'get'>;
  vectors?: PassageVectorIndex;
  ai?: KgBindings['AI'];
}): PassageEnv | null {
  const { db, bucket, vectors, ai } = bindings;
  return db && bucket && vectors && ai ? { db, bucket, vectors, ai } : null;
}

/** Vectorize ids are at most 64 bytes. */
export const VECTOR_ID_MAX_BYTES = 64;

/**
 * `p:<projectId>:<paperId>:<paragraphId>`, or `p#` + base64url(SHA-256 of that) when it is longer than Vectorize
 * allows (always, for two UUIDs). The D1 row keeps the id, so a match is mapped back without parsing it.
 */
export async function passageVectorId(projectId: string, paperId: string, paragraphId: string) {
  const raw = `p:${projectId}:${paperId}:${paragraphId}`;
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength <= VECTOR_ID_MAX_BYTES) return raw;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const base64 = btoa(String.fromCharCode(...digest));
  return `p#${base64.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}`;
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
