import {
  PassageReindexResponseSchema,
  PassageSearchResponseSchema,
  PassageStatusSchema,
  type PassageReindexRequest,
  type PassageSearchRequest,
} from '@/core/schemas/passages';
import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';

export class PassageError extends Error {
  constructor(
    message: string,
    public detail = '',
    public status?: number,
    public code = '',
  ) {
    super(message);
  }
}

function errorMessage(status: number, code: string) {
  if (code === 'passages_not_configured') return 'Chỉ mục đoạn văn chưa được cấu hình trên máy chủ lab.';
  if (code === 'corpus_not_found') return 'Không tìm thấy corpus này trong project.';
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Tài khoản này không được dùng chỉ mục đoạn văn.';
  if (status === 400) return 'Yêu cầu tìm đoạn văn chưa hợp lệ.';
  if (status >= 500) return `Máy chủ lab gặp lỗi khi tìm đoạn văn (HTTP ${status}).`;
  return `Yêu cầu tới chỉ mục đoạn văn gặp lỗi (HTTP ${status}).`;
}

async function request(
  path: string,
  token: string | null,
  projectId: string | null,
  init?: RequestInit,
): Promise<unknown> {
  if (!token) throw new PassageError('Hãy đăng nhập bằng tài khoản lab để tìm đoạn văn.');
  if (!projectId) throw new PassageError('Hãy mở PaperLab từ một project ResearchHub để tìm đoạn văn.');
  let response: Response;
  try {
    response = await fetch(projectScopedUrl(`${PDF_WORKER_URL}/v1/passages${path}`, projectId), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Project-Id': projectId,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new PassageError(
      'Không kết nối được máy chủ lab. Hãy kiểm tra mạng rồi thử lại.',
      cause instanceof Error ? cause.message : '',
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const code =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
  throw new PassageError(
    errorMessage(response.status, code),
    [`HTTP ${response.status}`, code].filter(Boolean).join(' · '),
    response.status,
    code,
  );
}

/** Hybrid passage search in the active project; each hit links to `/papers/:paperId?p=:paragraphId`. */
export async function searchPassages(
  input: PassageSearchRequest,
  token: string | null,
  projectId: string | null,
  signal?: AbortSignal,
) {
  const body = await request('/search', token, projectId, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
  return PassageSearchResponseSchema.parse(body);
}

/** Queues papers (a corpus, a list, or the whole project) for indexing; the server indexes one at once. */
export async function reindexPassages(
  input: PassageReindexRequest,
  token: string | null,
  projectId: string | null,
) {
  const body = await request('/reindex', token, projectId, { method: 'POST', body: JSON.stringify(input) });
  return PassageReindexResponseSchema.parse(body);
}

export async function getPassageStatus(token: string | null, projectId: string | null, signal?: AbortSignal) {
  return PassageStatusSchema.parse(await request('/status', token, projectId, { signal }));
}

/** The paper reader's link to one paragraph (the citation anchor). */
export const passageLink = (paperId: string, paragraphId: string) =>
  `/papers/${encodeURIComponent(paperId)}?p=${encodeURIComponent(paragraphId)}`;
