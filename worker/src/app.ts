import { NotAllowedError } from './auth';
import { GrobidStartingError } from './grobid-error';
import { handlePublished, publishedError } from './published';
import { handlePlans } from './plans';
import { handleMeasure, MEASURE_PATH } from './measure';
import { handleFactRequests } from './factRequests';
import { isAdmin } from './deps';
import { handleScg, SCG_LIST_PATH, SCG_PATH } from './scg';
import { handleOpenAlexPdf } from './openalexPdf';
import { MAX_PDF_BYTES } from './limits';
import { handleWorkspace } from './workspace';
import { DATA_PATH_PREFIX, handleData } from './data/routes';
import { handleKg } from './kg/routes';
import { handleSciAtlas, SCIATLAS_PATH } from './sciatlas';
import type { D1Database, KgBindings } from './kg/bindings';

/** The part of an R2 bucket this worker uses, so the logic runs in tests without Cloudflare. */
export interface Bucket {
  head(key: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number; etag: string } | null>;
  list(options: { prefix: string; cursor?: string; limit?: number; include: ['customMetadata'] }): Promise<{
    objects: { key: string; etag: string; customMetadata?: Record<string, string> }[];
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
}
/** Who signed the request: a Firebase ID token (lab tools and integrations) or a HyperDataLab SSO access token. */
export type CallerKind = 'firebase' | 'sso';
export interface Caller {
  uid: string;
  email: string;
  kind: CallerKind;
}
export interface Deps extends KgBindings {
  verifyToken: (token: string) => Promise<Caller>;
  bucket: Bucket;
  allowedOrigins: string[];
  adminEmails?: string[];
  now: () => Date;
  grobid?: (pdf: ArrayBuffer) => Promise<Response>;
  /** POST /nlp/parse on the topics worker with the caller's token; absent when `NLP_URL` is unset. */
  nlpParse?: (sentences: { key: string; text: string }[], token: string) => Promise<Response>;
  /** Outbound fetch for OpenAlex and its listed Open Access PDF mirrors. */
  externalFetch?: typeof fetch;
  /** Hosts that may receive user-authorized 9router requests through the same-origin Worker proxy. */
  llmAllowedHosts?: string[];
  /** Outbound fetch for the configured 9router endpoint. */
  llmFetch?: typeof fetch;
  /** Validates project ownership through the ResearchHub API. */
  getOwnedProject?: (projectId: string, token: string) => Promise<{ id: string; name: string } | null>;
  /** Stores file bytes in the ResearchHub project and returns the ResearchHub file ID. */
  uploadProjectFile?: (
    projectId: string,
    token: string,
    fileName: string,
    body: ArrayBuffer,
  ) => Promise<string>;
  /** Fetches file bytes from the ResearchHub Files API. */
  downloadProjectFile?: (projectId: string, fileId: string, token: string) => Promise<Response>;
  /** Lists file metadata from the active ResearchHub project. */
  listProjectFiles?: (projectId: string, cursor: string | null, token: string) => Promise<Response>;
  /** Project-scoped central record store. */
  data?: D1Database;
  kg?: KgBindings;
  sciatlasTimeoutMs?: number;
  /** SciAtlas API key, configured as a Worker secret. */
  sciatlasKey?: string;
  /** Active, owner-verified ResearchHub project for this request; absent in lab scope (ADR 0008). */
  projectId?: string;
  fetch?: typeof fetch;
}

export const MAX_BYTES = MAX_PDF_BYTES;
/** Previous PaperLab PDF objects kept for lazy migration to ResearchHub. */
export const PREFIX = 'paperlab/pdfs/';
export const PDF_LINK_PREFIX = 'paperlab/researchhub-file-links/';
export const GROBID_CACHE_TAG = 'grobid-0.9.0-crf';
const GROBID_SHA = /^\/grobid\/fulltext\/([0-9a-f]{64})$/;
const SHA = /^\/pdfs\/([0-9a-f]{64})$/;
const RESEARCH_HUB_FILE = /^\/v1\/researchhub\/files\/([0-9a-f-]{36})$/i;
const CORPUS = /^\/corpora\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const CORPUS_PREFIX = 'paperlab/corpora/';

function cors(request: Request, deps: Deps): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !deps.allowedOrigins.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, DELETE',
    'Access-Control-Expose-Headers': 'X-Grobid-Cache, X-Grobid-Ms, ETag, Retry-After',
    'Access-Control-Allow-Headers':
      'authorization, content-type, if-match, if-none-match, x-project-id, x-file-name, x-llm-api-key, x-llm-base-url',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}
const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function legacyPdfKey(sha: string) {
  return `${PREFIX}${sha}.pdf`;
}

function linkedProjectIds(metadata: Record<string, string> | undefined): string[] {
  if (!metadata) return [];
  if (metadata.projectIds) {
    try {
      const parsed: unknown = JSON.parse(metadata.projectIds);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      // Fall back to the previous single-project metadata field.
    }
  }
  return metadata.projectId ? [metadata.projectId] : [];
}

function errorStatus(error: unknown): number {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 502;
}

function safeErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown ResearchHub upload error';
  return message
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 240);
}

type ProjectPdfLink = { fileId: string; fileName: string };

function projectPdfLinkKey(projectId: string, sha: string) {
  return `${PDF_LINK_PREFIX}${projectId}/${sha}.json`;
}

async function getProjectPdfLink(deps: Deps, projectId: string, sha: string): Promise<ProjectPdfLink | null> {
  const object = await deps.bucket.get(projectPdfLinkKey(projectId, sha));
  if (!object) return null;
  const value: unknown = await new Response(object.body).json().catch(() => null);
  if (
    !value ||
    typeof value !== 'object' ||
    !('fileId' in value) ||
    typeof value.fileId !== 'string' ||
    !('fileName' in value) ||
    typeof value.fileName !== 'string'
  )
    return null;
  return { fileId: value.fileId, fileName: value.fileName };
}

async function saveProjectPdfLink(deps: Deps, projectId: string, sha: string, link: ProjectPdfLink) {
  const body = await new Response(JSON.stringify(link)).arrayBuffer();
  await deps.bucket.put(projectPdfLinkKey(projectId, sha), body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { projectId, sha256: sha, fileId: link.fileId },
  });
}

async function getProjectPdf(
  deps: Deps,
  sha: string,
  projectId: string,
  token: string,
): Promise<Response | null> {
  if (!deps.downloadProjectFile) throw new Error('ResearchHub file download is not configured');
  let link = await getProjectPdfLink(deps, projectId, sha);
  if (!link) {
    const key = legacyPdfKey(sha);
    const legacy = await deps.bucket.get(key);
    if (!legacy || !deps.uploadProjectFile) return null;
    const linked = linkedProjectIds((await deps.bucket.head(key))?.customMetadata);
    // Old globally stored PDFs without an explicit ResearchHub project link stay unassigned.
    if (!linked.includes(projectId)) return null;
    const body = await new Response(legacy.body).arrayBuffer();
    if ((await sha256Hex(body)) !== sha) return null;
    const fileName = (await deps.bucket.head(key))?.customMetadata?.originalName ?? `${sha}.pdf`;
    const fileId = await deps.uploadProjectFile(projectId, token, fileName, body);
    link = { fileId, fileName };
    await saveProjectPdfLink(deps, projectId, sha, link);
  }
  return deps.downloadProjectFile(projectId, link.fileId, token);
}

/** Lab scope: the lab's own R2 PDF store under `paperlab/pdfs/`, exactly as before ResearchHub projects. */
async function labPdf(
  deps: Deps,
  request: Request,
  sha: string,
  email: string,
  headers: Record<string, string>,
) {
  const key = legacyPdfKey(sha);
  if (request.method === 'HEAD')
    return new Response(null, { status: (await deps.bucket.head(key)) ? 200 : 404, headers });
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return json(404, { error: 'not stored' }, headers);
    return new Response(object.body, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Length': String(object.size) },
    });
  }
  if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);
  if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== 'application/pdf')
    return json(415, { error: 'expected application/pdf' }, headers);
  const length = request.headers.get('content-length');
  if (length === null) return json(411, { error: 'length required' }, headers);
  if (Number(length) > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  if (new TextDecoder().decode(body.slice(0, 5)) !== '%PDF-')
    return json(400, { error: 'not a PDF' }, headers);
  if ((await sha256Hex(body)) !== sha)
    return json(422, { error: 'content does not match its name' }, headers);
  if (await deps.bucket.head(key)) return json(200, { stored: true, existing: true }, headers);
  await deps.bucket.put(key, body, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { uploadedBy: email, uploadedAt: deps.now().toISOString() },
  });
  return json(201, { stored: true }, headers);
}

/**
 * Proxies PDF storage through the ResearchHub Files API. R2 stores only project/SHA to ResearchHub file-ID links.
 * Every file request verifies the authenticated user's access to the ResearchHub project.
 */
export async function handle(deps: Deps, request: Request): Promise<Response> {
  const headers = cors(request, deps);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(request.url).pathname;
  const isV1 = path === '/v1' || path.startsWith('/v1/');
  const match = SHA.exec(path);
  const researchHubFileMatch = RESEARCH_HUB_FILE.exec(path);
  const corpusMatch = CORPUS.exec(path);
  const grobidMatch = GROBID_SHA.exec(path);
  if (!isV1 && !match && !corpusMatch && !grobidMatch && path !== '/grobid/fulltext' && path !== '/corpora')
    return json(400, { error: 'invalid path' }, headers);

  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token)
    return isV1
      ? publishedError(401, 'unauthenticated', 'Sign-in required.', headers)
      : json(401, { error: 'sign-in required' }, headers);
  let caller: Caller;
  try {
    caller = await deps.verifyToken(token);
  } catch (cause) {
    if (isV1)
      return cause instanceof NotAllowedError
        ? publishedError(403, 'forbidden', 'Account not allowed.', headers)
        : publishedError(401, 'unauthenticated', 'Invalid token.', headers);
    return cause instanceof NotAllowedError
      ? json(403, { error: 'account not allowed' }, headers)
      : json(401, { error: 'invalid token' }, headers);
  }

  const headerProjectId = request.headers.get('X-Project-Id')?.trim() ?? '';
  const queryProjectId = new URL(request.url).searchParams.get('projectId')?.trim() ?? '';
  if (headerProjectId && queryProjectId && headerProjectId.toLowerCase() !== queryProjectId.toLowerCase())
    return json(400, { error: 'conflicting ResearchHub project ids' }, headers);
  const requestedProjectId = headerProjectId || queryProjectId;
  // No project id: lab scope, the global lab store. A project id: that ResearchHub project's scope (ADR 0008).
  const projectId = requestedProjectId ? requestedProjectId.toLowerCase() : null;
  // ResearchHub checks project ownership with the caller's SSO token, so a Firebase token has no project scope.
  if (projectId && caller.kind !== 'sso')
    return json(403, { error: 'project scope needs HyperDataLab SSO' }, headers);
  if (
    projectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId)
  )
    return json(400, { error: 'invalid ResearchHub project id' }, headers);
  if (projectId && (match || grobidMatch || (isV1 && path !== '/v1/me'))) {
    if (!deps.getOwnedProject)
      return json(503, { error: 'ResearchHub project access is not configured' }, headers);
    try {
      if (!(await deps.getOwnedProject(projectId, token)))
        return json(404, { error: 'ResearchHub project not found' }, headers);
    } catch {
      return json(502, { error: 'ResearchHub project access could not be verified' }, headers);
    }
  }

  if (isV1) {
    const projectDeps: Deps = projectId ? { ...deps, projectId } : deps;
    try {
      if (path === '/v1/me' && request.method === 'GET') {
        if (request.headers.has('X-Project-Id')) {
          if (!projectId || !deps.getOwnedProject)
            return json(400, { error: 'invalid ResearchHub project id' }, headers);
          const project = await deps.getOwnedProject(projectId, token);
          if (!project) return json(404, { error: 'ResearchHub project not found' }, headers);
          return json(200, { email: caller.email, admin: isAdmin(deps, caller.email), project }, headers);
        }
        return json(200, { email: caller.email, admin: isAdmin(deps, caller.email) }, headers);
      }
      if (path === '/v1/researchhub/files' && request.method === 'GET') {
        if (!projectId)
          return json(400, { error: 'X-Project-Id is required for ResearchHub files' }, headers);
        if (!deps.listProjectFiles)
          return json(503, { error: 'ResearchHub file listing is not configured' }, headers);
        const cursor = new URL(request.url).searchParams.get('cursor');
        let response: Response;
        try {
          response = await deps.listProjectFiles(projectId, cursor, token);
        } catch {
          return json(502, { error: 'ResearchHub file list unavailable' }, headers);
        }
        if (!response.ok)
          return json(response.status, { error: 'ResearchHub file list unavailable' }, headers);
        const result: unknown = await response.json().catch(() => null);
        if (!result || typeof result !== 'object' || !('items' in result) || !Array.isArray(result.items))
          return json(502, { error: 'ResearchHub returned an invalid file list' }, headers);
        const items = result.items.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const file = item as Record<string, unknown>;
          if (
            typeof file.id !== 'string' ||
            typeof file.name !== 'string' ||
            typeof file.contentType !== 'string' ||
            typeof file.size !== 'number' ||
            typeof file.uploadedAt !== 'string' ||
            typeof file.projectId !== 'string' ||
            file.projectId.toLowerCase() !== projectId
          )
            return [];
          return [
            {
              id: file.id,
              name: file.name,
              contentType: file.contentType,
              size: file.size,
              uploadedAt: file.uploadedAt,
              projectId,
            },
          ];
        });
        const nextCursor =
          'cursor' in result && (typeof result.cursor === 'string' || result.cursor === null)
            ? result.cursor
            : null;
        return json(200, { items, cursor: nextCursor }, headers);
      }
      if (researchHubFileMatch && request.method === 'GET') {
        if (!projectId)
          return json(400, { error: 'X-Project-Id is required for ResearchHub files' }, headers);
        if (!deps.downloadProjectFile)
          return json(503, { error: 'ResearchHub file download is not configured' }, headers);
        let response: Response;
        try {
          response = await deps.downloadProjectFile(projectId, researchHubFileMatch[1], token);
        } catch {
          return json(502, { error: 'ResearchHub file download failed' }, headers);
        }
        if (!response.ok)
          return json(response.status, { error: 'ResearchHub file download failed' }, headers);
        const responseHeaders = new Headers(headers);
        for (const name of ['content-type', 'content-length', 'content-disposition']) {
          const value = response.headers.get(name);
          if (value) responseHeaders.set(name, value);
        }
        return new Response(response.body, { status: response.status, headers: responseHeaders });
      }
      if (path === '/v1/llm/chat/completions') {
        if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, headers);
        const apiKey = request.headers.get('X-LLM-API-Key')?.trim();
        const baseUrl = request.headers.get('X-LLM-Base-URL')?.trim();
        if (!apiKey || !baseUrl) return json(400, { error: '9router configuration is missing.' }, headers);
        let endpoint: URL;
        try {
          endpoint = new URL(baseUrl);
        } catch {
          return json(400, { error: 'Invalid 9router endpoint.' }, headers);
        }
        const allowedHosts = deps.llmAllowedHosts ?? [];
        if (
          endpoint.protocol !== 'https:' ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash ||
          !allowedHosts.includes(endpoint.hostname.toLowerCase()) ||
          endpoint.pathname.includes('..')
        )
          return json(400, { error: '9router endpoint is not allowed by this Worker.' }, headers);
        const length = Number(request.headers.get('content-length'));
        if (Number.isFinite(length) && length > 8 * 1024 * 1024)
          return json(413, { error: 'The 9router request is too large.' }, headers);
        const body = await request.arrayBuffer();
        if (body.byteLength > 8 * 1024 * 1024)
          return json(413, { error: 'The 9router request is too large.' }, headers);
        endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, '')}/chat/completions`;
        let response: Response;
        try {
          response = await (deps.llmFetch ?? fetch)(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: request.signal,
          });
        } catch {
          return json(502, { error: 'Could not reach the configured 9router endpoint.' }, headers);
        }
        const responseHeaders = new Headers(headers);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('Content-Type', response.headers.get('Content-Type') ?? 'application/json');
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) responseHeaders.set('Retry-After', retryAfter);
        return new Response(response.body, { status: response.status, headers: responseHeaders });
      }
      if (path.startsWith(DATA_PATH_PREFIX))
        return await handleData(deps, request, path, caller.email, headers, projectId);
      if (path.startsWith('/v1/kg/')) return await handleKg(projectDeps, request, path, headers, projectId);
      if (path === '/v1/pdfs/openalex')
        return await handleOpenAlexPdf(request, headers, {
          fetch: deps.externalFetch ?? fetch,
        });
      if (path === SCIATLAS_PATH) return await handleSciAtlas(projectDeps, request, headers);
      if (path.startsWith('/v1/workspaces/')) {
        // Workspaces are ResearchHub projects; their ownership check needs the caller's SSO token.
        if (caller.kind !== 'sso')
          return json(403, { error: 'project scope needs HyperDataLab SSO' }, headers);
        if (!deps.getOwnedProject)
          return json(503, { error: 'ResearchHub project access is not configured' }, headers);
        return await handleWorkspace(
          request,
          token,
          { bucket: deps.bucket, getOwnedProject: deps.getOwnedProject },
          headers,
        );
      }
      if (path === MEASURE_PATH) return await handleMeasure(projectDeps, request, token, headers);
      if (path === SCG_LIST_PATH || SCG_PATH.test(path))
        return await handleScg(projectDeps, request, caller.email, headers);
      if (path.startsWith('/v1/admin/') || path.endsWith('/experiment-facts/requests'))
        return await handleFactRequests(projectDeps, request, caller.email, headers);
      return path === '/v1/projects' || path.startsWith('/v1/projects/')
        ? await handlePlans(projectDeps, request, caller.email, headers)
        : await handlePublished(projectDeps, request, caller.email, headers);
    } catch {
      return publishedError(500, 'internal', 'An internal error occurred.', headers);
    }
  }

  if (path === '/grobid/fulltext' || grobidMatch) {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, headers);
    const start = Date.now();
    let body: ArrayBuffer;
    let sha = grobidMatch?.[1];
    if (sha && !projectId) {
      // Lab scope reads the lab's own R2 PDF store, as before ResearchHub projects.
      const object = await deps.bucket.get(legacyPdfKey(sha));
      if (!object) return json(404, { error: 'not stored' }, headers);
      if (object.size > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
      body = await new Response(object.body).arrayBuffer();
    } else if (sha && projectId) {
      let fileResponse: Response | null;
      try {
        fileResponse = await getProjectPdf(deps, sha, projectId, token);
      } catch (error) {
        return json(errorStatus(error), { error: 'ResearchHub file download failed' }, headers);
      }
      if (!fileResponse?.ok)
        return json(fileResponse?.status ?? 404, { error: 'ResearchHub file not found' }, headers);
      body = await fileResponse.arrayBuffer();
    } else {
      if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== 'application/pdf')
        return json(415, { error: 'expected application/pdf' }, headers);
      if (Number(request.headers.get('content-length')) > MAX_BYTES)
        return json(413, { error: 'file too large' }, headers);
      body = await request.arrayBuffer();
    }
    if (body.byteLength > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
    if (new TextDecoder().decode(body.slice(0, 4)) !== '%PDF')
      return json(400, { error: 'not a PDF' }, headers);
    sha ??= await sha256Hex(body);
    const cacheKey = `paperlab/tei/${sha}-${GROBID_CACHE_TAG}.xml`;
    const cached = await deps.bucket.get(cacheKey);
    const resultHeaders = (state: string) => ({
      ...headers,
      'Content-Type': 'application/xml',
      'X-Grobid-Cache': state,
      'X-Grobid-Ms': String(Date.now() - start),
    });
    if (cached) return new Response(cached.body, { headers: resultHeaders('hit') });
    let response: Response;
    try {
      if (!deps.grobid) throw new Error('GROBID unavailable');
      response = await deps.grobid(body);
    } catch (error) {
      if (error instanceof GrobidStartingError)
        return json(503, { error: 'grobid starting' }, { ...headers, 'Retry-After': '30' });
      return json(502, { error: 'grobid unavailable' }, headers);
    }
    if (response.status !== 200)
      return json(502, { error: 'grobid error', status: response.status }, headers);
    let tei: ArrayBuffer;
    try {
      tei = await response.arrayBuffer();
    } catch {
      return json(502, { error: 'grobid response interrupted' }, headers);
    }
    await deps.bucket.put(cacheKey, tei, {
      httpMetadata: { contentType: 'application/xml' },
      customMetadata: {},
    });
    return new Response(tei, { headers: resultHeaders('miss') });
  }

  if (path === '/corpora' || corpusMatch) {
    if (path === '/corpora') {
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' }, headers);
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await deps.bucket.list({ prefix: CORPUS_PREFIX, cursor, include: ['customMetadata'] });
        items.push(
          ...page.objects.map((object) => ({
            id: object.key.slice(CORPUS_PREFIX.length),
            title: object.customMetadata?.title,
            kind: object.customMetadata?.kind,
            updatedAt: object.customMetadata?.updatedAt,
            version: object.etag,
          })),
        );
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return json(200, items, headers);
    }
    const id = corpusMatch?.[1] as string;
    const key = `${CORPUS_PREFIX}${id}`;
    if (request.method === 'GET') {
      const object = await deps.bucket.get(key);
      if (!object) return json(404, { error: 'not stored' }, headers);
      return json(
        200,
        { corpus: JSON.parse(await new Response(object.body).text()), version: object.etag },
        headers,
      );
    }
    if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);
    const expected = request.headers.get('if-match');
    const create = request.headers.get('if-none-match') === '*';
    if ((!expected && !create) || (expected && create))
      return json(400, { error: 'conditional write required' }, headers);
    if (Number(request.headers.get('content-length')) > 5 * 1024 * 1024)
      return json(413, { error: 'file too large' }, headers);
    const body = await request.arrayBuffer();
    if (body.byteLength > 5 * 1024 * 1024) return json(413, { error: 'file too large' }, headers);
    let value: {
      format?: unknown;
      schemaVersion?: unknown;
      id?: unknown;
      title?: unknown;
      kind?: unknown;
      updatedAt?: unknown;
    };
    try {
      value = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json(400, { error: 'invalid JSON' }, headers);
    }
    if (
      !value ||
      value.format !== 'paperlab-corpus' ||
      value.schemaVersion !== 1 ||
      value.id !== id ||
      typeof value.title !== 'string' ||
      typeof value.kind !== 'string' ||
      typeof value.updatedAt !== 'string'
    )
      return json(400, { error: 'invalid corpus' }, headers);
    const stored = await deps.bucket.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        title: value.title,
        kind: value.kind,
        updatedAt: value.updatedAt,
        updatedBy: caller.email,
      },
      onlyIf: create ? { etagDoesNotMatch: '*' } : { etagMatches: expected as string },
    });
    if (!stored) return json(409, { version: (await deps.bucket.head(key))?.etag ?? null }, headers);
    return json(create ? 201 : 200, { version: stored.etag }, headers);
  }
  const sha = match?.[1] as string;
  if (!projectId) return labPdf(deps, request, sha, caller.email, headers);
  if (request.method === 'HEAD') {
    const link = projectId ? await getProjectPdfLink(deps, projectId, sha) : null;
    return new Response(null, {
      status: link ? 200 : 404,
      headers,
    });
  }
  if (request.method === 'GET') {
    let fileResponse: Response | null;
    try {
      fileResponse = projectId ? await getProjectPdf(deps, sha, projectId, token) : null;
    } catch (error) {
      return json(errorStatus(error), { error: 'ResearchHub file download failed' }, headers);
    }
    if (!fileResponse?.ok)
      return json(fileResponse?.status ?? 404, { error: 'ResearchHub file not found' }, headers);
    const responseHeaders = new Headers(headers);
    for (const name of ['content-type', 'content-length', 'content-disposition']) {
      const value = fileResponse.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(fileResponse.body, { status: 200, headers: responseHeaders });
  }
  if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);

  if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== 'application/pdf')
    return json(415, { error: 'expected application/pdf' }, headers);
  const length = request.headers.get('content-length');
  if (length === null) return json(411, { error: 'length required' }, headers);
  if (Number(length) > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return json(413, { error: 'file too large' }, headers);
  if (new TextDecoder().decode(body.slice(0, 5)) !== '%PDF-')
    return json(400, { error: 'not a PDF' }, headers);
  if ((await sha256Hex(body)) !== sha)
    return json(422, { error: 'content does not match its name' }, headers);
  if (!projectId) return json(400, { error: 'X-Project-Id is required for PDF uploads' }, headers);
  if (!deps.uploadProjectFile)
    return json(503, { error: 'ResearchHub file upload is not configured' }, headers);
  if (await getProjectPdfLink(deps, projectId, sha)) {
    return json(200, { stored: true, existing: true }, headers);
  }
  const suppliedName = request.headers.get('X-File-Name')?.trim() ?? '';
  let fileName = suppliedName || `${sha}.pdf`;
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // ResearchHub performs its own filename validation; keep the supplied value if encoding is malformed.
  }
  fileName =
    [...fileName]
      .map((character) => {
        const code = character.charCodeAt(0);
        return character === '/' || character === '\\' || code < 0x20 ? '_' : character;
      })
      .join('')
      .slice(0, 180) || `${sha}.pdf`;
  try {
    const fileId = await deps.uploadProjectFile(projectId, token, fileName, body);
    await saveProjectPdfLink(deps, projectId, sha, { fileId, fileName });
  } catch (error) {
    console.error('ResearchHub file upload failed', {
      status: errorStatus(error),
      detail: safeErrorDetail(error),
    });
    return json(
      errorStatus(error),
      { error: 'ResearchHub file upload failed', detail: safeErrorDetail(error) },
      headers,
    );
  }
  return json(201, { stored: true }, headers);
}
