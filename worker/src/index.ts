import { createRemoteJWKSet } from 'jose';
import { getContainer } from '@cloudflare/containers';
import { handle, type Bucket } from './app';
import { SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';
import { GrobidStartingError } from './grobid-error';

export { GrobidContainer } from './grobid';

interface Env {
  BUCKET: Bucket;
  FIREBASE_PROJECT_ID: string;
  ACCEPTED_PROJECT_IDS?: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
  ADMIN_EMAILS: string;
  GROBID: Parameters<typeof getContainer>[0];
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
      },
      request,
    );
  },
};
