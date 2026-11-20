const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
const WORKSPACE = /^\/v1\/workspaces\/([0-9a-f-]{36})$/iu;

interface WorkspaceBucket {
  get(key: string): Promise<{ body: ReadableStream; size: number; etag: string } | null>;
  head(key: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null>;
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

interface HubProject {
  id: string;
  name: string;
}

interface WorkspaceDeps {
  bucket: WorkspaceBucket;
  getOwnedProject: (projectId: string, token: string) => Promise<HubProject | null>;
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

function validSnapshot(value: unknown, projectId: string): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const payload = snapshot.payload;
  return (
    snapshot.format === 'paperlab-project-workspace' &&
    snapshot.schemaVersion === 1 &&
    snapshot.projectId === projectId &&
    typeof snapshot.updatedAt === 'string' &&
    Number.isFinite(Date.parse(snapshot.updatedAt)) &&
    !!payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
  );
}

export async function handleWorkspace(
  request: Request,
  token: string,
  deps: WorkspaceDeps,
  headers: Record<string, string>,
) {
  const projectId = WORKSPACE.exec(new URL(request.url).pathname)?.[1];
  if (!projectId) return json(400, { error: 'invalid project id' }, headers);
  let project: HubProject | null;
  try {
    project = await deps.getOwnedProject(projectId, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ResearchHub project access could not be checked';
    const upstreamStatus =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : null;
    const status = upstreamStatus && upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 503;
    console.error('ResearchHub project access check failed', { projectId, status, message });
    return json(status, { error: message }, headers);
  }
  if (!project) return json(404, { error: 'ResearchHub project not found' }, headers);

  const key = `paperlab/workspaces/${projectId}.json`;
  if (request.method === 'GET') {
    const object = await deps.bucket.get(key);
    if (!object) return json(200, { project, snapshot: null, version: null }, headers);
    if (object.size > MAX_WORKSPACE_BYTES) return json(500, { error: 'stored workspace is too large' }, headers);
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(new TextDecoder().decode(await new Response(object.body).arrayBuffer()));
    } catch {
      return json(500, { error: 'stored workspace is invalid' }, headers);
    }
    if (!validSnapshot(snapshot, projectId)) return json(500, { error: 'stored workspace does not match project' }, headers);
    return json(200, { project, snapshot, version: object.etag }, { ...headers, ETag: object.etag });
  }
  if (request.method !== 'PUT') return json(405, { error: 'method not allowed' }, headers);

  const expectedVersion = request.headers.get('If-Match');
  const createOnly = request.headers.get('If-None-Match') === '*';
  if (!expectedVersion && !createOnly) return json(428, { error: 'If-Match or If-None-Match is required' }, headers);
  if (expectedVersion && createOnly) return json(400, { error: 'choose one version condition' }, headers);
  if (Number(request.headers.get('content-length')) > MAX_WORKSPACE_BYTES)
    return json(413, { error: 'workspace exceeds 25 MiB' }, headers);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_WORKSPACE_BYTES) return json(413, { error: 'workspace exceeds 25 MiB' }, headers);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: 'invalid JSON' }, headers);
  }
  if (!validSnapshot(snapshot, projectId)) return json(400, { error: 'workspace schema or project id is invalid' }, headers);

  const saved = await deps.bucket.put(key, bytes, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { projectId, updatedAt: snapshot.updatedAt as string },
    onlyIf: expectedVersion ? { etagMatches: expectedVersion } : { etagDoesNotMatch: '*' },
  });
  if (!saved) {
    const current = await deps.bucket.head(key);
    return json(412, { error: 'workspace changed in another session', version: current?.etag ?? null }, headers);
  }
  return json(200, { project, version: saved.etag }, { ...headers, ETag: saved.etag });
}
