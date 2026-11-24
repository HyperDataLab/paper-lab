import { r2Prefix, type ProjectScope } from './scope';
import { planSchema, type ExperimentPlan } from '../../src/core/researchDesign/plan/schema';
import { validatePlan } from '../../src/core/researchDesign/plan/validatePlan';
import { exportPackage } from '../../src/core/researchDesign/plan/exportPackage';
import type { Deps } from './app';
import { publishedError } from './published';

const PREFIX = (projectId: ProjectScope) => r2Prefix(projectId, 'plans');
const PATH =
  /^\/v1\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/plans(?:\/([1-9][0-9]*)(\/package)?)?$/;
const MAX_BYTES = 5 * 1024 * 1024;
type Headers = Record<string, string>;
const json = (status: number, value: unknown, headers: Headers) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

async function versions(deps: Deps, id: string) {
  const prefix = `${PREFIX(deps.projectId)}${id}/`;
  const objects: { key: string; customMetadata?: Record<string, string> }[] = [];
  let cursor: string | undefined;
  do {
    const page = await deps.bucket.list({ prefix, cursor, include: ['customMetadata'] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects
    .flatMap((object) => {
      const match = /^([1-9][0-9]*)\.json$/.exec(object.key.slice(prefix.length));
      if (!match) return [];
      const meta = object.customMetadata ?? {};
      return [
        {
          version: Number(match[1]),
          frozenAt: meta.frozenAt,
          frozenBy: meta.frozenBy,
          etag: meta.contentEtag,
        },
      ];
    })
    .sort((a, b) => a.version - b.version);
}

export async function handlePlans(deps: Deps, request: Request, email: string, headers: Headers) {
  const url = new URL(request.url);
  if (url.pathname === '/v1/projects' && request.method === 'GET') {
    const page = await deps.bucket.list({
      prefix: PREFIX(deps.projectId),
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 100,
      include: ['customMetadata'],
    });
    const items = await Promise.all(
      page.objects
        .filter((object) => object.key.endsWith('/project.json'))
        .map(async (object) => {
          const projectId = object.key.slice(PREFIX(deps.projectId).length, -'/project.json'.length);
          const meta = object.customMetadata ?? {};
          const entries = await versions(deps, projectId);
          return {
            projectId,
            title: meta.title,
            updatedAt: meta.updatedAt,
            publishedBy: meta.publishedBy,
            latestVersion: entries.at(-1)?.version ?? null,
          };
        }),
    );
    return json(200, { items, nextCursor: page.truncated ? (page.cursor ?? null) : null }, headers);
  }
  const match = PATH.exec(url.pathname);
  if (
    !match ||
    (request.method !== 'GET' && request.method !== 'PUT') ||
    (!match[2] && request.method !== 'GET') ||
    (match[3] && request.method !== 'GET')
  )
    return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
  const id = match[1] as string;
  const version = match[2];
  if (!version) {
    const entries = await versions(deps, id);
    return entries.length
      ? json(200, { versions: entries }, headers)
      : publishedError(404, 'not_found', 'Project was not found.', headers);
  }
  if (!Number.isSafeInteger(Number(version)))
    return publishedError(400, 'bad_request', 'Invalid version.', headers);
  const key = `${PREFIX(deps.projectId)}${id}/${version}.json`;
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return publishedError(404, 'not_found', 'Plan was not found.', headers);
    const etag = (await deps.bucket.head(key))?.customMetadata?.contentEtag;
    if (!etag) throw new Error('Missing content ETag');
    const responseHeaders = {
      ...headers,
      ETag: `"${etag}"`,
      'Content-Type': match[3] ? 'application/zip' : 'application/json',
    };
    const requested = request.headers
      .get('if-none-match')
      ?.replace(/^W\//u, '')
      .replace(/^"(.*)"$/u, '$1');
    if (requested === etag) return new Response(null, { status: 304, headers: responseHeaders });
    if (!match[3]) return new Response(object.body, { headers: responseHeaders });
    const plan: unknown = JSON.parse(await new Response(object.body).text());
    planSchema.parse(plan);
    // Parsing with Zod reorders keys and trims strings, which changes the browser package hashes.
    const pack = await exportPackage(plan as ExperimentPlan);
    return new Response(new Uint8Array(pack.bytes).buffer, { headers: responseHeaders });
  }
  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    return publishedError(413, 'bad_request', 'Plan exceeds 5 MiB.', headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return publishedError(413, 'bad_request', 'Plan exceeds 5 MiB.', headers);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return publishedError(400, 'bad_request', 'Invalid JSON.', headers);
  }
  if (value && typeof value === 'object' && 'planVersion' in value && value.planVersion !== Number(version))
    return publishedError(400, 'bad_request', 'Plan version does not match the path.', headers);
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    return json(
      422,
      { error: 'plan_invalid', message: 'Invalid plan.', issues: parsed.error.issues },
      headers,
    );
  const issues = validatePlan(parsed.data).filter((issue) => issue.level === 'blocking');
  if (issues.length) return json(422, { error: 'plan_invalid', message: 'Invalid plan.', issues }, headers);
  const digest = await crypto.subtle.digest('SHA-256', body);
  const etag = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const publishedAt = deps.now().toISOString();
  const updateProject = async () => {
    const project = {
      projectId: id,
      title: (value as ExperimentPlan).title,
      updatedAt: publishedAt,
      publishedBy: email,
    };
    await deps.bucket.put(
      `${PREFIX(deps.projectId)}${id}/project.json`,
      new TextEncoder().encode(JSON.stringify(project)).buffer,
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { title: project.title, updatedAt: publishedAt, publishedBy: email },
      },
    );
  };
  const existing = await deps.bucket.head(key);
  if (existing) {
    if (existing.customMetadata?.contentEtag !== etag)
      return publishedError(409, 'conflict', 'Frozen plan versions never change.', headers);
    await updateProject();
    return json(200, { unchanged: true }, headers);
  }
  const stored = await deps.bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      contentEtag: etag,
      frozenAt: parsed.data.frozenAt,
      frozenBy: parsed.data.frozenBy,
      publishedBy: email,
      publishedAt,
    },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!stored) {
    const winner = await deps.bucket.head(key);
    if (winner?.customMetadata?.contentEtag !== etag)
      return publishedError(409, 'conflict', 'Frozen plan versions never change.', headers);
    await updateProject();
    return json(200, { unchanged: true }, headers);
  }
  await updateProject();
  return json(201, { projectId: id, version: Number(version), etag }, headers);
}
