import { Container, getContainer } from '@cloudflare/containers';
import { createRemoteJWKSet } from 'jose';
import { handle, refreshJob, type Bucket, type Deps } from './app';
import { SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';

export class TopicsContainer extends Container<Env> {
  private bucket: Bucket;
  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args);
    this.bucket = args[1].BUCKET;
  }
  defaultPort = 8080;
  sleepAfter = '15m';
  enableInternet = true;
  private refreshInFlight = new Map<string, Promise<boolean>>();
  private refresh(jobId: string): Promise<boolean> {
    let pending = this.refreshInFlight.get(jobId);
    if (!pending) {
      pending = refreshJob(
        this.bucket,
        (path, init) => this.containerFetch(`http://container${path}`, init),
        jobId,
      ).finally(() => {
        this.refreshInFlight.delete(jobId);
      });
      this.refreshInFlight.set(jobId, pending);
    }
    return pending;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_refresh' && request.method === 'POST') {
      const { jobId } = (await request.json()) as { jobId: string };
      await this.refresh(jobId);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/_schedule' && request.method === 'POST') {
      const { jobId } = (await request.json()) as { jobId: string };
      await this.schedule(20, 'pollJob', jobId);
      return Response.json({ ok: true });
    }
    return super.fetch(request);
  }
  async pollJob(jobId: string): Promise<void> {
    this.renewActivityTimeout();
    try {
      if (await this.refresh(jobId)) await this.schedule(20, 'pollJob', jobId);
    } catch (error) {
      console.error(
        `jobId=${jobId} polling exception:`,
        error instanceof Error ? error.message : String(error),
      );
      await this.schedule(20, 'pollJob', jobId);
    }
  }
}
/** spaCy parse service (topics-worker/nlp): a small image of its own, so a parse never wakes the torch container. */
export class NlpContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = false;
}
interface Env {
  BUCKET: Bucket;
  DATA: Deps['data'];
  TOPICS: Parameters<typeof getContainer>[0];
  NLP: Parameters<typeof getContainer>[0];
  FIREBASE_PROJECT_ID: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
}
const jwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS));
export default {
  fetch(request: Request, env: Env) {
    return handle(request, {
      bucket: env.BUCKET,
      data: env.DATA,
      origins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      verify: (token) => verifyFirebaseToken(token, jwks, env.FIREBASE_PROJECT_ID, env.ALLOWED_DOMAIN),
      container: (path, init) => getContainer(env.TOPICS).fetch(`http://container${path}`, init),
      nlp: (path, init) => getContainer(env.NLP).fetch(`http://container${path}`, init),
      refresh: async (jobId) => {
        await getContainer(env.TOPICS).fetch('http://container/_refresh', {
          method: 'POST',
          body: JSON.stringify({ jobId }),
        });
      },
      schedule: async (jobId) => {
        const response = await getContainer(env.TOPICS).fetch('http://container/_schedule', {
          method: 'POST',
          body: JSON.stringify({ jobId }),
        });
        if (!response.ok) throw new Error(`Failed to schedule job: ${response.status}`);
      },
    });
  },
};
