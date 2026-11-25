import { PDF_WORKER_URL } from './index';

export interface ResearchHubProject {
  id: string;
  name: string;
}

export interface CreateResearchHubProjectInput {
  name: string;
  description: string;
}

export class ResearchHubProjectListError extends Error {
  constructor(
    public readonly status: number,
    detail?: string,
    operation: 'list' | 'create' = 'list',
  ) {
    super(
      detail ||
        (status === 401
          ? 'Phiên SSO đã hết hạn. Hãy đăng nhập lại.'
          : status === 403
            ? operation === 'create'
              ? 'Tài khoản hiện tại không có quyền tạo project ResearchHub.'
              : 'Tài khoản hiện tại không có quyền xem danh sách project.'
            : operation === 'create'
              ? `Không tạo được project ResearchHub (HTTP ${status}).`
              : `Không tải được project từ ResearchHub (HTTP ${status}).`),
    );
  }
}

function isProject(value: unknown): value is ResearchHubProject {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id) &&
    'name' in value &&
    typeof value.name === 'string' &&
    Boolean(value.name.trim())
  );
}

/** Lists only the authenticated user's ResearchHub projects through the token-validating PaperLab Worker. */
export async function listResearchHubProjects(token: string, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${PDF_WORKER_URL}/v1/me/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ResearchHubProjectListError(0, 'Không kết nối được PaperLab Worker để tải project.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object'
        ? 'message' in body && typeof body.message === 'string'
          ? body.message
          : 'error' in body && typeof body.error === 'string'
            ? body.error
            : undefined
        : undefined;
    throw new ResearchHubProjectListError(response.status, detail);
  }
  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items))
    throw new ResearchHubProjectListError(502, 'Worker trả về danh sách project không hợp lệ.');
  return body.items.filter(isProject).map((project) => ({ ...project, name: project.name.trim() }));
}

/** Creates a real ResearchHub project through the token-validating PaperLab Worker. */
export async function createResearchHubProject(
  token: string,
  input: CreateResearchHubProjectInput,
  signal?: AbortSignal,
): Promise<ResearchHubProject> {
  let response: Response;
  try {
    response = await fetch(`${PDF_WORKER_URL}/v1/me/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ResearchHubProjectListError(0, 'Không kết nối được PaperLab Worker để tạo project.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object'
        ? 'message' in body && typeof body.message === 'string'
          ? body.message
          : 'error' in body && typeof body.error === 'string'
            ? body.error
            : undefined
        : undefined;
    throw new ResearchHubProjectListError(response.status, detail, 'create');
  }
  if (!body || typeof body !== 'object' || !('project' in body) || !isProject(body.project))
    throw new ResearchHubProjectListError(502, 'ResearchHub trả về project không hợp lệ.', 'create');
  return { ...body.project, name: body.project.name.trim() };
}
