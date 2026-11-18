import { z } from 'zod';
import { scgBodyEtag, type ScgPaperPublish } from '@/core/scg/publish';
import { PDF_WORKER_URL } from './index';

const PublishResultSchema = z.object({
  paperId: z.string(),
  etag: z.string().regex(/^[0-9a-f]{64}$/u),
  updatedAt: z.iso.datetime(),
  unchanged: z.boolean(),
});
const ErrorSchema = z.looseObject({ error: z.string() });

export class PublishScgError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Phiên đăng nhập đã hết hạn.'
        : status === 403
          ? 'Tài khoản này không được công bố lên máy chủ lab.'
          : status === 404
            ? 'Paper model của bài chưa được công bố. Hãy công bố paper model trước.'
            : status === 409
              ? 'Đồ thị dẫn tới câu không có trong paper model đã công bố. Hãy công bố lại paper model, hoặc chạy lại trích đóng góp.'
              : status === 413
                ? 'Đồ thị đóng góp vượt quá 2 MiB.'
                : status < 500
                  ? `Máy chủ lab không chấp nhận đồ thị đóng góp (lỗi ${status}).`
                  : `Máy chủ lab gặp lỗi ${status}. Vui lòng thử lại.`,
    );
  }
}

const scgUrl = (paperId: string) => `${PDF_WORKER_URL}/v1/papers/${encodeURIComponent(paperId)}/scg`;

/** Sends one paper's graph; the worker stores it only when the paper model is published. */
export async function publishScg(graph: ScgPaperPublish, token: string) {
  const response = await fetch(scgUrl(graph.paperId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(graph),
  });
  if (!response.ok) throw new PublishScgError(response.status);
  return PublishResultSchema.parse(await response.json());
}

/**
 * Where the published copy stands against the local graph: `no_model` when the paper model is not
 * published, `none` when no graph is, `current` when the published ETag is the local one, else `outdated`.
 */
export type ScgPublishState = 'no_model' | 'none' | 'current' | 'outdated';
export async function scgPublishState(graph: ScgPaperPublish, token: string): Promise<ScgPublishState> {
  const etag = await scgBodyEtag(JSON.stringify(graph));
  const response = await fetch(scgUrl(graph.paperId), {
    headers: { Authorization: `Bearer ${token}`, 'If-None-Match': `"${etag}"` },
  });
  if (response.status === 304) return 'current';
  if (response.status === 404) {
    const body = ErrorSchema.safeParse(await response.json().catch(() => null));
    return body.success && body.data.error === 'paper_not_published' ? 'no_model' : 'none';
  }
  if (!response.ok) throw new PublishScgError(response.status);
  return response.headers
    .get('ETag')
    ?.replace(/^W\//u, '')
    .replace(/^"(.*)"$/u, '$1') === etag
    ? 'current'
    : 'outdated';
}
