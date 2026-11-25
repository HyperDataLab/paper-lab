import { Container, getContainer } from '@cloudflare/containers';
import { createRemoteJWKSet, customFetch } from 'jose';
import { handle, refreshJob, type Bucket, type Deps } from './app';
import { cachedSsoVerifier, dualVerifier, SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';

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
  TOPICS: Parameters<typeof getContainer>[0];
  NLP: Parameters<typeof getContainer>[0];
  DATA: Deps['data'];
  RESEARCH_HUB: { fetch(request: Request): Promise<Response> };
  RESEARCH_HUB_API_URL?: string;
  FIREBASE_PROJECT_ID: string;
  ACCEPTED_PROJECT_IDS?: string;
  SSO_BASE_URL: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
}

async function getOwnedProject(env: Env, projectId: string, token: string) {
  const baseUrl = env.RESEARCH_HUB_API_URL?.trim();
  if (!baseUrl) throw new Error('RESEARCH_HUB_API_URL is not configured');
  const response = await env.RESEARCH_HUB.fetch(
    new Request(new URL('/api/projects', baseUrl), { headers: { Authorization: `Bearer ${token}` } }),
  );
  if (!response.ok) throw new Error(`ResearchHub project access returned HTTP ${response.status}`);
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || !('items' in result) || !Array.isArray(result.items))
    throw new Error('ResearchHub returned an invalid project list');
  const project = result.items.find(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof item.id === 'string' &&
      item.id.toLowerCase() === projectId.toLowerCase(),
  );
  return project ? { id: projectId, name: 'ResearchHub project' } : null;
}
// A Worker's fetch goes through Cloudflare's cache, which keeps Google's key set for its ~7 h max-age; after a key
// rotation every newly signed token would fail. jose already caches the keys in the isolate.
const jwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS), {
  [customFetch]: (url, options) => fetch(url, { ...options, cache: 'no-store' }),
});
// One verifier per isolate, so the SSO userinfo cache outlives a single request.
let verifier: { key: string; verify: ReturnType<typeof dualVerifier> } | undefined;
function verifyToken(env: Env) {
  const projects = (env.ACCEPTED_PROJECT_IDS ?? env.FIREBASE_PROJECT_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const key = JSON.stringify([projects, env.SSO_BASE_URL, env.ALLOWED_DOMAIN]);
  if (verifier?.key !== key)
    verifier = {
      key,
      verify: dualVerifier({
        firebase: (token) => verifyFirebaseToken(token, jwks, projects, env.ALLOWED_DOMAIN),
        sso: cachedSsoVerifier({ ssoBaseUrl: env.SSO_BASE_URL, domain: env.ALLOWED_DOMAIN }),
      }),
    };
  return verifier.verify;
}
export default {
  fetch(request: Request, env: Env) {
    return handle(request, {
      bucket: env.BUCKET,
      data: env.DATA,
      origins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      verify: verifyToken(env),
      getOwnedProject: (projectId, token) => getOwnedProject(env, projectId, token),
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
