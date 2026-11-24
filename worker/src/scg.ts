import { r2Prefix, type ProjectScope } from './scope';
import { scgBodyEtag, ScgPaperPublishSchema } from '../../src/core/scg/publish';
import { normalizeDoi } from '../../src/core/library/doi';
import type { Deps } from './app';
import { kgRepo } from './kg/repo';
import { publishedError } from './published';

/**
 * One paper's published contribution graph (`paperlab-scg-paper` v1), next to its published paper model.
 * A PUT overwrites: a graph can be re-reviewed after it is published, and each new body gets a new ETag.
 */
const PREFIX = (projectId: ProjectScope) => r2Prefix(projectId, 'scg');
const MODEL_PREFIX = (projectId: ProjectScope) => r2Prefix(projectId, 'published');
export const SCG_PATH =
  /^\/v1\/papers\/(sha256-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/scg$/;
export const SCG_LIST_PATH = '/v1/scg';
const MAX_BYTES = 2 * 1024 * 1024;
type Headers = Record<string, string>;
const json = (status: number, value: unknown, headers: Headers) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
const notPublished = (id: string, headers: Headers) =>
  publishedError(404, 'paper_not_published', `Paper ${id} has no published model.`, headers);

export async function handleScg(deps: Deps, request: Request, email: string, headers: Headers) {
  const url = new URL(request.url);
  if (url.pathname === SCG_LIST_PATH) {
    if (request.method !== 'GET')
      return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
    const page = await deps.bucket.list({
      prefix: PREFIX(deps.projectId),
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 100,
      include: ['customMetadata'],
    });
    const items = page.objects
      .filter((object) => object.key.endsWith('.json'))
      .map((object) => {
        const meta = object.customMetadata ?? {};
        return {
          paperId: object.key.slice(PREFIX(deps.projectId).length, -'.json'.length),
          doi: meta.doi || null,
          s2CorpusId: meta.s2CorpusId || null,
          idBase: meta.idBase || null,
          contributions: Number(meta.contributions ?? 0),
          updatedAt: meta.updatedAt,
          etag: meta.contentEtag,
          modelEtag: meta.modelEtag || null,
        };
      });
    return json(200, { items, nextCursor: page.truncated ? (page.cursor ?? null) : null }, headers);
  }
  const match = SCG_PATH.exec(url.pathname);
  if (!match || (request.method !== 'GET' && request.method !== 'PUT'))
    return publishedError(400, 'bad_request', 'Invalid path or method.', headers);
  const id = match[1] as string;
  const key = `${PREFIX(deps.projectId)}${id}.json`;
  const modelKey = `${MODEL_PREFIX(deps.projectId)}${id}/model.json`;

  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) {
      if (!(await deps.bucket.head(modelKey))) return notPublished(id, headers);
      return publishedError(404, 'not_found', `Paper ${id} has no published contribution graph.`, headers);
    }
    const etag = (await deps.bucket.head(key))?.customMetadata?.contentEtag;
    if (!etag) throw new Error('Missing content ETag');
    const responseHeaders = { ...headers, ETag: `"${etag}"`, 'Content-Type': 'application/json' };
    const ifNoneMatch = request.headers
      .get('if-none-match')
      ?.replace(/^W\//u, '')
      .replace(/^"(.*)"$/u, '$1');
    if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(object.body, { headers: responseHeaders });
  }

  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    return publishedError(413, 'bad_request', 'Contribution graph exceeds 2 MiB.', headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES)
    return publishedError(413, 'bad_request', 'Contribution graph exceeds 2 MiB.', headers);
  const modelHead = await deps.bucket.head(modelKey);
  if (!modelHead) return notPublished(id, headers);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return publishedError(400, 'bad_request', 'Invalid JSON.', headers);
  }
  const result = ScgPaperPublishSchema.safeParse(parsed);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
    return publishedError(
      400,
      'bad_request',
      `Invalid contribution graph: ${fields.slice(0, 5).join(', ')}.`,
      headers,
    );
  }
  const graph = result.data;
  if (graph.paperId !== id)
    return publishedError(400, 'bad_request', 'paperId does not match the path.', headers);

  // Evidence must point at sentences of the model readers will fetch.
  const modelObject = await deps.bucket.get(modelKey);
  if (!modelObject) return notPublished(id, headers);
  const model = (await new Response(modelObject.body).json()) as { sentences?: { key?: unknown }[] };
  const known = new Set((model.sentences ?? []).map((sentence) => sentence.key));
  const unknown = graph.contributions.some(
    (contribution) =>
      contribution.sourceSentenceKeys.some((sentenceKey) => !known.has(sentenceKey)) ||
      contribution.prerequisites.some((prerequisite) =>
        prerequisite.sourceSentenceKeys.some((sentenceKey) => !known.has(sentenceKey)),
      ),
  );
  if (unknown)
    return publishedError(
      409,
      'conflict',
      'Evidence names sentences the published model does not have.',
      headers,
    );

  const etag = await scgBodyEtag(body);
  const existing = await deps.bucket.head(key);
  const unchanged = existing?.customMetadata?.contentEtag === etag;
  const now = deps.now().toISOString();
  const updatedAt = unchanged ? (existing.customMetadata?.updatedAt ?? now) : now;
  if (!unchanged)
    await deps.bucket.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        doi: graph.doi ?? '',
        s2CorpusId: graph.s2CorpusId ?? '',
        idBase: graph.idBase,
        contributions: String(graph.contributions.length),
        schemaVersion: 'scg-paper-v1',
        updatedAt,
        publishedBy: email,
        contentEtag: etag,
        modelEtag: modelHead.customMetadata?.contentEtag ?? '',
      },
    });
  // Even an identical PUT can be a retry after publication reached R2 but the KG write failed.
  if (deps.kg?.KG) {
    const doi = normalizeDoi(graph.doi ?? '') ?? normalizeDoi(modelHead.customMetadata?.doi ?? '');
    await kgRepo(deps.kg.KG).upsertScg(graph, doi, now);
  }
  return json(200, { paperId: id, etag, updatedAt, unchanged }, headers);
}
