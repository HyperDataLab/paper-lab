import type { D1Database, KgBindings } from './kg/bindings';

/** The part of an R2 bucket this worker uses, so the logic runs in tests without Cloudflare. */
export interface Bucket {
  head(key: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number; etag: string } | null>;
  list(options: { prefix: string; cursor?: string; limit?: number; include: ['customMetadata'] }): Promise<{
    objects: { key: string; etag: string; uploaded?: Date; customMetadata?: Record<string, string> }[];
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
    },
  ): Promise<{ etag: string } | null>;
  /** Used by the lab data store to remove orphan bodies; optional so older test fakes still fit. */
  delete?(keys: string | string[]): Promise<void>;
}
export interface Deps {
  verifyToken: (token: string) => Promise<{ uid: string; email: string }>;
  bucket: Bucket;
  allowedOrigins: string[];
  adminEmails?: string[];
  now: () => Date;
  grobid?: (pdf: ArrayBuffer) => Promise<Response>;
  /** POST /nlp/parse on the topics worker with the caller's token; absent when `NLP_URL` is unset. */
  nlpParse?: (sentences: { key: string; text: string }[], token: string) => Promise<Response>;
  /** The `SCIATLAS_API_KEY` secret; absent → POST /v1/sciatlas/search answers 503. Never logged or returned. */
  sciatlasKey?: string;
  /** Outbound fetch for SciAtlas and OpenAlex; tests replace it. */
  fetch?: typeof fetch;
  sciatlasTimeoutMs?: number;
  kg?: KgBindings;
  /** The central lab store's D1 (`DATA`); absent → /v1/data answers 503. */
  data?: D1Database;
}

export const isAdmin = (deps: Deps, email: string) => (deps.adminEmails ?? []).includes(email.toLowerCase());
