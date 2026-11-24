import { getContainer } from '@cloudflare/containers';
import { handle, type Bucket } from './app';
import { verifySsoToken } from './auth';
import { GrobidStartingError } from './grobid-error';
import { collectOrphanBodies } from './data/gc';
import { configuredKg, type D1Database, type KgBindings } from './kg/bindings';
import { drainKgQueue } from './kg/ingest';

export { GrobidContainer } from './grobid';

interface Env extends KgBindings {
  BUCKET: Bucket;
  SSO_BASE_URL: string;
  RESEARCH_HUB_API_URL?: string;
  RESEARCH_HUB: { fetch(request: Request): Promise<Response> };
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
  ADMIN_EMAILS: string;
  LLM_ALLOWED_HOSTS?: string;
  GROBID: Parameters<typeof getContainer>[0];
  /** Base URL of the topics worker that serves POST /nlp/parse; unset → POST /v1/measure skips passive and tense. */
  NLP_URL?: string;
  DATA?: D1Database;
  SCIATLAS_API_KEY?: string;
}

class ResearchHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function researchHubRequest(env: Env, path: string, init: RequestInit, token: string) {
  const baseUrl = env.RESEARCH_HUB_API_URL?.trim();
  if (!baseUrl) throw new Error('RESEARCH_HUB_API_URL is not configured');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return env.RESEARCH_HUB.fetch(new Request(new URL(path, baseUrl), { ...init, headers }));
}

async function listOwnedProjects(env: Env, token: string) {
  const baseUrl = env.RESEARCH_HUB_API_URL?.trim();
  if (!baseUrl) throw new ResearchHubApiError(503, 'RESEARCH_HUB_API_URL is not configured');
  let response: Response;
  try {
    response = await researchHubRequest(env, '/api/projects', { method: 'GET' }, token);
  } catch (error) {
    throw new ResearchHubApiError(
      502,
      error instanceof Error ? `ResearchHub request failed: ${error.name}` : 'ResearchHub request failed',
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error.slice(0, 240)
        : null;
    const responseUrl = response.url ? new URL(response.url) : new URL('/api/projects', baseUrl);
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'unknown content type';
    throw new ResearchHubApiError(
      response.status,
      `ResearchHub API responded with HTTP ${response.status} from ${responseUrl.host}${responseUrl.pathname} (${contentType})${detail ? `: ${detail}` : ''}`,
    );
  }
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || !('items' in result) || !Array.isArray(result.items))
    throw new ResearchHubApiError(502, 'ResearchHub returned an invalid project list');
  return result.items.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('name' in item)) return [];
    if (
      typeof item.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim()
    )
      return [];
    return [{ id: item.id, name: item.name.trim() }];
  });
}

async function getOwnedProject(env: Env, projectId: string, token: string) {
  const projects = await listOwnedProjects(env, token);
  const project = projects.find((item) => item.id.toLowerCase() === projectId.toLowerCase());
  return project ?? null;
}

async function uploadResearchHubFile(
  env: Env,
  projectId: string,
  token: string,
  fileName: string,
  body: ArrayBuffer,
) {
  let response: Response;
  try {
    response = await researchHubRequest(
      env,
      '/api/files',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(body.byteLength),
          'X-File-Name': encodeURIComponent(fileName),
          'X-Project-Id': projectId,
        },
        body,
      },
      token,
    );
  } catch (error) {
    throw new ResearchHubApiError(
      502,
      error instanceof Error ? `ResearchHub upload failed: ${error.name}` : 'ResearchHub upload failed',
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new ResearchHubApiError(
      response.status,
      bodyText.slice(0, 240) || 'ResearchHub file upload failed',
    );
  }
  const value: unknown = await response.json().catch(() => null);
  const fileId =
    value &&
    typeof value === 'object' &&
    'item' in value &&
    value.item &&
    typeof value.item === 'object' &&
    'id' in value.item &&
    typeof value.item.id === 'string'
      ? value.item.id
      : null;
  if (!fileId) throw new ResearchHubApiError(502, 'ResearchHub returned an invalid file response');
  return fileId;
}

function downloadResearchHubFile(env: Env, projectId: string, fileId: string, token: string) {
  const path = `/api/files/${encodeURIComponent(fileId)}?projectId=${encodeURIComponent(projectId)}`;
  return researchHubRequest(env, path, { method: 'GET' }, token);
}

function listResearchHubFiles(env: Env, projectId: string, cursor: string | null, token: string) {
  const query = new URLSearchParams({ projectId });
  if (cursor) query.set('cursor', cursor);
  return researchHubRequest(env, `/api/files?${query.toString()}`, { method: 'GET' }, token);
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
        verifyToken: (token) => verifySsoToken(token, env.SSO_BASE_URL, env.ALLOWED_DOMAIN),
        getOwnedProject: (projectId, token) => getOwnedProject(env, projectId, token),
        listOwnedProjects: (token) => listOwnedProjects(env, token),
        uploadProjectFile: (projectId, token, fileName, body) =>
          uploadResearchHubFile(env, projectId, token, fileName, body),
        downloadProjectFile: (projectId, fileId, token) =>
          downloadResearchHubFile(env, projectId, fileId, token),
        listProjectFiles: (projectId, cursor, token) => listResearchHubFiles(env, projectId, cursor, token),
        bucket: env.BUCKET,
        allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
        adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()),
        now: () => new Date(),
        grobid: (pdf) => processPdf(env.GROBID, pdf),
        nlpParse: nlpParse(env),
        llmAllowedHosts: (env.LLM_ALLOWED_HOSTS ?? '')
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean),
        llmFetch: fetch,
        sciatlasKey: env.SCIATLAS_API_KEY,
        kg: env,
        data: env.DATA,
      },
      request,
    );
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const kg = configuredKg(env);
    if (kg) {
      const [rows] = await kg.db.batch<{ projectId: string }>([
        kg.db.prepare(`SELECT DISTINCT substr(id, 5, instr(substr(id, 5), '/') - 1) AS projectId
          FROM ingest_queue WHERE id LIKE '@rh/%'`),
      ]);
      for (const { projectId } of rows?.results ?? [])
        await drainKgQueue(kg, { now: () => new Date(), projectId });
    }
    if (env.DATA) await collectOrphanBodies(env.DATA, env.BUCKET, new Date());
  },
};
