import { NotAllowedError } from './auth';
import { NLP_PATH, parseNlp } from './nlp';

export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream } | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}
export interface Deps {
  bucket: Bucket;
  data: {
    prepare(sql: string): {
      bind(...values: (string | null)[]): { first<T>(): Promise<T | null> };
    };
  };
  origins: string[];
  verify(token: string): Promise<unknown>;
  getOwnedProject?(projectId: string, token: string): Promise<{ id: string; name: string } | null>;
  container(path: string, init?: RequestInit): Promise<Response>;
  schedule(jobId: string): Promise<void>;
  refresh?(jobId: string): Promise<void>;
  /** The spaCy parse container (POST /nlp/parse); absent → that path answers 404. */
  nlp?(path: string, init?: RequestInit): Promise<Response>;
  /** Test seam for the wait between attempts to reach a starting container. */
  sleep?(ms: number): Promise<void>;
}
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const route = new RegExp(`^/corpora/(${uuid})/topics(?:/run(?:/(${uuid}))?)?$`, 'i');
const idPattern = new RegExp(`^${uuid}$`, 'i');
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const physicalCorpusId = (projectId: string | null, id: string) =>
  projectId ? `@rh/${projectId}/${id}` : id;
const topicSnapshotKey = (projectId: string | null, id: string) =>
  projectId
    ? `paperlab/projects/${projectId}/corpora-topics/${id}.json`
    : `paperlab/corpora-topics/${id}.json`;

async function loadCorpus(
  { data, bucket }: Deps,
  id: string,
  projectId: string | null,
): Promise<{ body: unknown } | null> {
  const row = await data
    .prepare(
      "SELECT body_json, r2_key, deleted_at FROM doc WHERE collection = 'corpora' AND id = ? AND hub_project_id IS ?",
    )
    .bind(physicalCorpusId(projectId, id), projectId)
    .first<{ body_json: string | null; r2_key: string | null; deleted_at: string | null }>();
  // A tombstone also takes precedence over any legacy object.
  if (row?.deleted_at != null) return null;
  if (row?.body_json != null) return { body: JSON.parse(row.body_json) as unknown };
  // The legacy key belongs to lab scope only. Never let a project request fall back to unscoped corpus data.
  const key = row ? row.r2_key : projectId ? null : `paperlab/corpora/${id}`;
  const stored = key === null ? null : await bucket.get(key);
  return stored ? { body: (await new Response(stored.body).json()) as unknown } : null;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && deps.origins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, PUT, POST';
    headers['Access-Control-Allow-Headers'] =
      'authorization, content-type, if-match, if-none-match, x-project-id';
    headers['Access-Control-Max-Age'] = '3600';
  }
  const json = (status: number, value: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { ...headers, ...extra, 'Content-Type': 'application/json' },
    });
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(request.url).pathname;
    const match = route.exec(path);
    if (!match && path !== NLP_PATH) return json(400, { error: 'invalid path' });
    const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return json(401, { error: 'sign-in required' });
    try {
      await deps.verify(token);
    } catch (error) {
      return json(error instanceof NotAllowedError ? 403 : 401, { error: 'invalid token' });
    }
    if (!match) {
      if (!deps.nlp) return json(404, { error: 'nlp not configured' });
      return await parseNlp(request, deps.nlp, json, deps.sleep ?? defaultSleep);
    }
    const headerProjectId = request.headers.get('X-Project-Id')?.trim() ?? '';
    const queryProjectId = new URL(request.url).searchParams.get('projectId')?.trim() ?? '';
    if (headerProjectId && queryProjectId && headerProjectId.toLowerCase() !== queryProjectId.toLowerCase())
      return json(400, { error: 'conflicting ResearchHub project ids' });
    const requestedProjectId = headerProjectId || queryProjectId;
    if (requestedProjectId && !idPattern.test(requestedProjectId))
      return json(400, { error: 'invalid ResearchHub project id' });
    const projectId = requestedProjectId ? requestedProjectId.toLowerCase() : null;
    if (projectId) {
      if (!deps.getOwnedProject) return json(503, { error: 'ResearchHub project access is not configured' });
      try {
        if (!(await deps.getOwnedProject(projectId, token)))
          return json(404, { error: 'ResearchHub project not found' });
      } catch (error) {
        console.error(
          'ResearchHub project access check failed',
          error instanceof Error ? error.message : String(error),
        );
        return json(502, { error: 'ResearchHub project access could not be verified' });
      }
    }
    const corpusId = match[1] as string;
    const jobId = match[2];
    const isRun = path.endsWith('/run') || Boolean(jobId);
    if (!isRun) {
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
      const stored = await deps.bucket.get(topicSnapshotKey(projectId, corpusId));
      return stored
        ? new Response(stored.body, { headers: { ...headers, 'Content-Type': 'application/json' } })
        : json(404, { error: 'not stored' });
    }
    const call = async (url: string, init?: RequestInit) => {
      try {
        return await deps.container(url, init);
      } catch (error) {
        console.error('container request error:', error instanceof Error ? error.message : String(error));
        return null;
      }
    };
    if (!jobId) {
      if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'invalid JSON' });
      }
      if (
        !object(body) ||
        (body.controlIds !== undefined &&
          (!Array.isArray(body.controlIds) ||
            !body.controlIds.every((id: unknown) => typeof id === 'string' && idPattern.test(id))))
      )
        return json(400, { error: 'invalid controls' });
      const ids = [corpusId, ...((body.controlIds as string[] | undefined) ?? [])];
      if (new Set(ids).size !== ids.length) return json(400, { error: 'duplicate corpus' });
      const corpora = [];
      const members = [];
      let analyzableMembers = 0;
      for (const id of ids) {
        const stored = await loadCorpus(deps, id, projectId);
        if (!stored) return json(404, { error: 'corpus not stored' });
        const corpus = stored.body;
        if (
          !object(corpus) ||
          corpus.id !== id ||
          !Array.isArray(corpus.members) ||
          (id !== corpusId && corpus.kind !== 'control')
        )
          return json(400, { error: 'invalid corpus' });
        corpora.push({
          corpusId: id,
          title: corpus.title,
          kind: corpus.kind,
          ...(corpus.releaseId ? { releaseId: corpus.releaseId } : {}),
        });
        for (const m of corpus.members) {
          if (!object(m) || typeof m.memberId !== 'string') return json(400, { error: 'invalid member' });
          const identifiers = object(m.identifiers) ? m.identifiers : {};
          const title = typeof m.title === 'string' ? m.title.trim() : '';
          const openalexId = typeof identifiers.openalexId === 'string' ? identifiers.openalexId.trim() : '';
          const doi = typeof identifiers.doi === 'string' ? identifiers.doi.trim() : '';
          if (title || openalexId || doi) analyzableMembers += 1;
          members.push({
            corpusId: id,
            memberId: m.memberId,
            title,
            openalexId: openalexId || null,
            doi: doi || null,
          });
        }
      }
      if (analyzableMembers < 6)
        return json(422, {
          error: 'At least 6 papers with a title or DOI/OpenAlex identifier are required to calculate topics',
        });
      // A container that is starting or stopping answers with plain text ("Container ..."), not JSON: wait and
      // try again for about half a minute before asking the client to retry.
      const payload = JSON.stringify({ corpora, members });
      let response: Response | null = null;
      let value: unknown = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) await (deps.sleep ?? defaultSleep)(5000);
        response = await call('/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (!response) continue;
        const text = await response.text();
        try {
          value = JSON.parse(text);
        } catch {
          console.log(
            `container not ready (attempt ${attempt + 1}): ${response.status} ${text.slice(0, 120)}`,
          );
          response = null;
          continue;
        }
        if (response.status === 503) {
          response = null;
          continue;
        }
        break;
      }
      if (!response) return json(503, { error: 'container starting' }, { 'Retry-After': '20' });
      if (response.status !== 202) return json(response.status, value);
      if (!object(value) || typeof value.jobId !== 'string' || !idPattern.test(value.jobId))
        return json(502, { error: 'invalid job' });
      const now = new Date().toISOString();
      const record = {
        jobId: value.jobId,
        corpusIds: ids,
        projectId,
        startedAt: now,
        updatedAt: now,
        state: 'queued',
        progress: 'Queued',
      };
      await saveJob(deps.bucket, record);
      await deps.schedule(value.jobId);
      console.log(`jobId=${value.jobId} state=queued progress=Queued elapsed=0s`);
      return json(202, value);
    }
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
    let record = await readJob(deps.bucket, jobId);
    if (!record || record.projectId !== projectId || !record.corpusIds.includes(corpusId))
      return json(404, { error: 'job not found' });
    if (deps.refresh && record.state !== 'done' && record.state !== 'failed') {
      try {
        await deps.refresh(jobId);
        record = (await readJob(deps.bucket, jobId)) ?? record;
      } catch (error) {
        console.error('topics status refresh error:', error instanceof Error ? error.message : String(error));
      }
    }
    return json(200, record);
  } catch (error) {
    console.error('topics handler error:', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'topics service error' });
  }
}

export interface JobRecord {
  jobId: string;
  corpusIds: string[];
  projectId: string | null;
  startedAt: string;
  updatedAt: string;
  state: string;
  progress: string;
  error?: string;
  snapshotId?: string;
}
const jobKey = (id: string) => `paperlab/corpora-topics/jobs/${id}.json`;
export async function readJob(bucket: Bucket, id: string): Promise<JobRecord | null> {
  const stored = await bucket.get(jobKey(id));
  return stored ? ((await new Response(stored.body).json()) as JobRecord) : null;
}
export async function saveJob(bucket: Bucket, job: JobRecord): Promise<void> {
  await bucket.put(jobKey(job.jobId), JSON.stringify(job), {
    httpMetadata: { contentType: 'application/json' },
  });
}
export async function refreshJob(
  bucket: Bucket,
  container: Deps['container'],
  jobId: string,
): Promise<boolean> {
  const job = await readJob(bucket, jobId);
  if (!job || job.state === 'done' || job.state === 'failed') return false;
  try {
    const response = await container(`/jobs/${jobId}`);
    if (response.status === 404) {
      const error = 'Container no longer has this job';
      console.error(`jobId=${jobId} error=${error}`);
      const next = {
        ...job,
        state: 'failed',
        progress: 'Failed',
        error,
        updatedAt: new Date().toISOString(),
      };
      await saveJob(bucket, next);
      console.log(
        `jobId=${jobId} state=failed progress=Failed elapsed=${Math.round((Date.now() - Date.parse(job.startedAt)) / 1000)}s`,
      );
      return false;
    }
    if (!response.ok) throw new Error(`Container status: ${response.status}`);
    const status: unknown = await response.json();
    if (!object(status) || !['queued', 'running', 'done', 'failed'].includes(String(status.state)))
      throw new Error('Invalid container status');
    const next = {
      ...job,
      state: String(status.state),
      progress: typeof status.progress === 'string' ? status.progress : job.progress,
      updatedAt: new Date().toISOString(),
    };
    if (next.state === 'failed') {
      next.error = typeof status.error === 'string' ? status.error : 'Container job failed';
      console.error(`jobId=${jobId} error=${next.error}`);
    }
    if (next.state === 'done') {
      const result = await container(`/jobs/${jobId}/result`);
      if (!result.ok) throw new Error(`Container result: ${result.status}`);
      const snapshot: unknown = await result.json();
      if (
        !object(snapshot) ||
        snapshot.format !== 'paperlab-corpus-topics' ||
        snapshot.schemaVersion !== 1 ||
        typeof snapshot.snapshotId !== 'string' ||
        !Array.isArray(snapshot.members) ||
        !Array.isArray(snapshot.topics) ||
        !Array.isArray(snapshot.corpora) ||
        !job.corpusIds.every((id) =>
          (snapshot.corpora as unknown[]).some((c) => object(c) && c.corpusId === id),
        )
      ) {
        const error = 'Invalid container result';
        console.error(`jobId=${jobId} error=${error}`);
        await saveJob(bucket, {
          ...job,
          state: 'failed',
          progress: 'Failed',
          error,
          updatedAt: new Date().toISOString(),
        });
        console.log(
          `jobId=${jobId} state=failed progress=Failed elapsed=${Math.round((Date.now() - Date.parse(job.startedAt)) / 1000)}s`,
        );
        return false;
      }
      for (const id of job.corpusIds)
        await bucket.put(topicSnapshotKey(job.projectId ?? null, id), JSON.stringify(snapshot), {
          httpMetadata: { contentType: 'application/json' },
        });
      next.snapshotId = snapshot.snapshotId;
    }
    await saveJob(bucket, next);
    if (job.state !== next.state || job.progress !== next.progress)
      console.log(
        `jobId=${jobId} state=${next.state} progress=${next.progress} elapsed=${Math.round((Date.now() - Date.parse(job.startedAt)) / 1000)}s`,
      );
    return next.state !== 'done' && next.state !== 'failed';
  } catch (error) {
    console.error(`jobId=${jobId} refresh error:`, error instanceof Error ? error.message : String(error));
    return true;
  }
}
