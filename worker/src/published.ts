import { r2Prefix, type ProjectScope } from './scope';
import type { Deps } from './app';
import { completeFactRequest, readFactRequest } from './factRequests';

const PREFIX = (projectId: ProjectScope) => r2Prefix(projectId, 'published');
const MODEL_PATH =
  /^\/v1\/papers\/(sha256-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(model|experiment-facts)$/;
const MAX_BYTES = 10 * 1024 * 1024;
type Headers = Record<string, string>;
const json = (status: number, value: unknown, headers: Headers) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
export const publishedError = (status: number, error: string, message: string, headers: Headers) =>
  json(status, { error, message }, headers);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export async function handlePublished(deps: Deps, request: Request, email: string, headers: Headers) {
  const url = new URL(request.url);
  if (url.pathname === '/v1/papers' && request.method === 'GET') {
    const page = await deps.bucket.list({
      prefix: PREFIX(deps.projectId),
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 100,
      include: ['customMetadata'],
    });
    const items = await Promise.all(
      page.objects
        .filter((object) => object.key.endsWith('/model.json'))
        .map((object) => {
          const meta = object.customMetadata ?? {};
          return {
            paperId: object.key.slice(PREFIX(deps.projectId).length, -'/model.json'.length),
            title: meta.title,
            doi: meta.doi || null,
            sourceSha256: meta.sourceSha256 || null,
            schemaVersion: meta.schemaVersion,
            updatedAt: meta.updatedAt,
            publishedBy: meta.publishedBy,
            experimentFacts: meta.experimentFacts,
          };
        })
        .filter((item) => {
          const doi = url.searchParams.get('doi');
          const sha = url.searchParams.get('sourceSha256');
          const since = url.searchParams.get('updatedSince');
          return (
            (!doi || item.doi?.toLowerCase() === doi.toLowerCase()) &&
            (!sha || item.sourceSha256 === sha) &&
            (!since || (item.updatedAt ?? '') >= since)
          );
        })
        .map(async (item) => {
          const request = await readFactRequest(deps, item.paperId);
          return request ? { ...item, factsRequest: request.value.state } : item;
        }),
    );
    return json(200, { items, nextCursor: page.truncated ? (page.cursor ?? null) : null }, headers);
  }
  const match = MODEL_PATH.exec(url.pathname);
  if (!match || (request.method !== 'GET' && request.method !== 'PUT'))
    return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
  const id = match[1] as string;
  const isFacts = match[2] === 'experiment-facts';
  const modelKey = `${PREFIX(deps.projectId)}${id}/model.json`;
  const key = isFacts ? `${PREFIX(deps.projectId)}${id}/experiment-facts.json` : modelKey;
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return publishedError(404, 'not_found', `Paper ${id} was not found.`, headers);
    const meta = await deps.bucket.head(key);
    const etag = meta?.customMetadata?.contentEtag;
    if (!etag) throw new Error('Missing content ETag');
    const responseHeaders = { ...headers, ETag: `"${etag}"`, 'Content-Type': 'application/json' };
    const ifNoneMatch = request.headers
      .get('if-none-match')
      ?.replace(/^W\//u, '')
      .replace(/^"(.*)"$/u, '$1');
    if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(object.body, { headers: responseHeaders });
  }
  const publishedModel = isFacts ? await deps.bucket.head(modelKey) : null;
  if (isFacts && !publishedModel)
    return publishedError(404, 'not_found', `Paper ${id} was not found.`, headers);
  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    return publishedError(413, 'bad_request', 'Model exceeds 10 MiB.', headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES)
    return publishedError(413, 'bad_request', 'Model exceeds 10 MiB.', headers);
  let value: Record<string, unknown> | undefined;
  try {
    value = record(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    /* Invalid JSON is a bad request. */
  }
  const document = record(value?.document);
  const metadata = record(document?.metadata);
  const source = record(document?.source);
  if (isFacts) {
    if (
      !value ||
      value.format !== 'paperlab-experiment-facts' ||
      value.schemaVersion !== 1 ||
      value.paperId !== id ||
      typeof value.modelEtag !== 'string' ||
      !/^[0-9a-f]{64}$/iu.test(value.modelEtag) ||
      !Array.isArray(value.facts)
    )
      return publishedError(400, 'bad_request', 'Invalid experiment facts.', headers);
    if (value.modelEtag !== publishedModel?.customMetadata?.contentEtag)
      return publishedError(409, 'conflict', 'Experiment facts do not match the published model.', headers);
  } else if (
    !value ||
    value.format !== 'paperlab-paper-model' ||
    value.schemaVersion !== 1 ||
    typeof metadata?.title !== 'string' ||
    !Array.isArray(value.sentences)
  )
    return publishedError(400, 'bad_request', 'Invalid paper model.', headers);
  // PaperLab records the file hash as `sha256:<hex>`; the list and the id use the bare hex.
  const sourceSha256 =
    typeof source?.sha256 === 'string' ? source.sha256.replace(/^sha256:/u, '').toLowerCase() : '';
  if (!isFacts && id.startsWith('sha256-') && sourceSha256 !== id.slice(7))
    return publishedError(400, 'bad_request', 'Paper ID does not match the source SHA-256.', headers);
  const content = { ...value };
  delete content.generatedAt;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  const etag = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const existing = await deps.bucket.head(key);
  if (isFacts) {
    const unchanged = existing?.customMetadata?.contentEtag === etag;
    const updatedAt = unchanged ? existing.customMetadata?.updatedAt : deps.now().toISOString();
    if (!unchanged)
      await deps.bucket.put(key, body, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { contentEtag: etag, updatedAt: updatedAt as string, publishedBy: email },
      });
    const facts = value?.facts as unknown[];
    const status =
      facts.length > 0 && facts.every((fact) => record(fact)?.status === 'accepted')
        ? 'reviewed'
        : 'candidate';
    if (publishedModel?.customMetadata?.experimentFacts !== status) {
      const modelObject = await deps.bucket.get(modelKey);
      if (!modelObject) throw new Error('Published model disappeared');
      await deps.bucket.put(modelKey, await new Response(modelObject.body).arrayBuffer(), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { ...publishedModel?.customMetadata, experimentFacts: status },
      });
    }
    await completeFactRequest(deps, id);
    return json(200, { paperId: id, etag, updatedAt, unchanged }, headers);
  }
  if (existing?.customMetadata?.contentEtag === etag)
    return json(
      200,
      { paperId: id, etag, updatedAt: existing.customMetadata.updatedAt, unchanged: true },
      headers,
    );
  const updatedAt = deps.now().toISOString();
  await deps.bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      title: metadata?.title as string,
      doi: typeof metadata?.doi === 'string' ? metadata.doi : '',
      sourceSha256,
      schemaVersion: 'paper-model-v1',
      updatedAt,
      publishedBy: email,
      contentEtag: etag,
      experimentFacts: existing?.customMetadata?.experimentFacts ?? 'none',
    },
  });
  return json(200, { paperId: id, etag, updatedAt, unchanged: false }, headers);
}
