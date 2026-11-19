import { createRemoteJWKSet } from 'jose';
import { getContainer } from '@cloudflare/containers';
import { handle, type Bucket } from './app';
import { SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';
import { GrobidStartingError } from './grobid-error';
import { collectOrphanBodies } from './data/gc';
import { configuredKg, type D1Database, type KgBindings } from './kg/bindings';
import { drainKgQueue } from './kg/ingest';

export { GrobidContainer } from './grobid';

interface Env extends KgBindings {
  BUCKET: Bucket;
  FIREBASE_PROJECT_ID: string;
  ACCEPTED_PROJECT_IDS?: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
  ADMIN_EMAILS: string;
  GROBID: Parameters<typeof getContainer>[0];
  /** Base URL of the topics worker that serves POST /nlp/parse; unset → POST /v1/measure skips passive and tense. */
  NLP_URL?: string;
  /** Secret (`wrangler secret put SCIATLAS_API_KEY`), never a [vars] entry; unset → SciAtlas search answers 503. */
  SCIATLAS_API_KEY?: string;
  /** The central lab store (`paperlab-data`); unset until the owner creates it → /v1/data answers 503. */
  DATA?: D1Database;
}

function nlpParse(env: Env) {
  const base = (env.NLP_URL ?? '').trim().replace(/\/+$/u, '');
  if (!base) return undefined;
  return (sentences: { key: string; text: string }[], token: string) =>
    fetch(`${base}/nlp/parse`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences }),
    });
}

const jwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS));

async function processPdf(binding: Env['GROBID'], pdf: ArrayBuffer): Promise<Response> {
  const container = getContainer(binding);
  const deadline = Date.now() + 120_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (Date.now() < deadline) {
          try {
            const response = await container.fetch('http://container/api/isalive');
            if (response.ok) return;
          } catch {
            // Startup can refuse connections until GROBID has loaded its models.
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new GrobidStartingError();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GrobidStartingError()), 120_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const form = new FormData();
  form.append('input', new Blob([pdf], { type: 'application/pdf' }), 'paper.pdf');
  form.append('consolidateHeader', '0');
  form.append('consolidateCitations', '0');
  form.append('segmentSentences', '1');
  for (const value of ['s', 'ref', 'biblStruct', 'head', 'p']) form.append('teiCoordinates', value);
  return container.fetch('http://container/api/processFulltextDocument', { method: 'POST', body: form });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(
      {
        verifyToken: (token) =>
          verifyFirebaseToken(
            token,
            jwks,
            (env.ACCEPTED_PROJECT_IDS ?? env.FIREBASE_PROJECT_ID)
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
            env.ALLOWED_DOMAIN,
          ),
        bucket: env.BUCKET,
        allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
        adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()),
        now: () => new Date(),
        grobid: (pdf) => processPdf(env.GROBID, pdf),
        nlpParse: nlpParse(env),
        sciatlasKey: env.SCIATLAS_API_KEY,
        kg: env,
        data: env.DATA,
      },
      request,
    );
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const kg = configuredKg(env);
    if (kg) await drainKgQueue(kg, { now: () => new Date() });
    if (env.DATA) await collectOrphanBodies(env.DATA, env.BUCKET, new Date());
  },
};
