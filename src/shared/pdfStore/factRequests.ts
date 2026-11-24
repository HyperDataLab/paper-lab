import { z } from 'zod';
import { PDF_WORKER_URL, projectScopedUrl } from './index';

export const FACT_REQUEST_STATES = ['requested', 'approved', 'declined', 'done'] as const;
export type FactRequestState = (typeof FACT_REQUEST_STATES)[number];

const MeSchema = z.looseObject({ email: z.string(), admin: z.boolean() });

// Fields the worker may leave out are optional; the list adds the published paper's title and DOI.
const FactRequestSchema = z.looseObject({
  paperId: z.string(),
  state: z.enum(FACT_REQUEST_STATES),
  note: z.string().nullish(),
  requestedBy: z.string().nullish(),
  requestedAt: z.string().nullish(),
  decidedBy: z.string().nullish(),
  decidedAt: z.string().nullish(),
  decisionNote: z.string().nullish(),
  title: z.string().nullish(),
  doi: z.string().nullish(),
});
export type FactRequest = z.infer<typeof FactRequestSchema>;

const FactRequestPageSchema = z.object({
  items: z.array(FactRequestSchema),
  nextCursor: z.string().nullish(),
});

export class FactRequestError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Chỉ quản trị viên PaperLab được duyệt yêu cầu dữ kiện thí nghiệm.'
          : status === 404
            ? 'Máy chủ lab không tìm thấy yêu cầu này.'
            : status === 409
              ? 'Yêu cầu này đã được xử lý trước đó.'
              : status < 500
                ? `Máy chủ lab không nhận yêu cầu (lỗi ${status}).`
                : `Máy chủ lab gặp lỗi ${status}. Vui lòng thử lại.`,
    );
  }
}

const auth = (token: string, projectId: string) => ({
  Authorization: `Bearer ${token}`,
  'X-Project-Id': projectId,
});

/** Who the lab server says the caller is. Only the server decides who is an admin. */
export async function getMe(token: string, projectId?: string) {
  const url = projectId ? projectScopedUrl(`${PDF_WORKER_URL}/v1/me`, projectId) : `${PDF_WORKER_URL}/v1/me`;
  const headers = projectId ? auth(token, projectId) : { Authorization: `Bearer ${token}` };
  const response = await fetch(url, { headers });
  if (!response.ok) throw new FactRequestError(response.status);
  return MeSchema.parse(await response.json());
}

export async function listFactRequests(
  token: string,
  projectId: string,
  state?: FactRequestState,
  cursor?: string,
) {
  const query = new URLSearchParams();
  if (state) query.set('state', state);
  if (cursor) query.set('cursor', cursor);
  const search = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(
    projectScopedUrl(`${PDF_WORKER_URL}/v1/admin/fact-requests${search}`, projectId),
    {
      headers: auth(token, projectId),
    },
  );
  if (!response.ok) throw new FactRequestError(response.status);
  const page = FactRequestPageSchema.parse(await response.json());
  return { items: page.items, nextCursor: page.nextCursor ?? null };
}

export async function decideFactRequest(
  token: string,
  projectId: string,
  paperId: string,
  decision: 'approve' | 'decline',
  note?: string,
) {
  const trimmed = note?.trim();
  const response = await fetch(
    projectScopedUrl(
      `${PDF_WORKER_URL}/v1/admin/fact-requests/${encodeURIComponent(paperId)}/decision`,
      projectId,
    ),
    {
      method: 'POST',
      headers: { ...auth(token, projectId), 'Content-Type': 'application/json' },
      body: JSON.stringify(trimmed ? { decision, note: trimmed } : { decision }),
    },
  );
  if (!response.ok) throw new FactRequestError(response.status);
  return FactRequestSchema.parse(await response.json());
}
