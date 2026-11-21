import { z } from 'zod';
import {
  SciAtlasSearchResponseSchema,
  type SciAtlasSearchRequest,
  type SciAtlasSearchResponse,
} from '@/core/openkg';
import { PDF_WORKER_URL } from '@/shared/pdfStore';

export type SciAtlasErrorCode =
  | 'signed_out'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_configured'
  | 'auth'
  | 'quota'
  | 'timeout'
  | 'bad_request'
  | 'network'
  | 'error';

const MESSAGES: Record<SciAtlasErrorCode, string> = {
  signed_out: 'Hãy đăng nhập bằng tài khoản lab để lấy thêm id từ SciAtlas.',
  unauthenticated: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  forbidden: 'Tài khoản này không được dùng SciAtlas qua máy chủ lab.',
  not_configured:
    'Máy chủ lab chưa có token SciAtlas. Chủ dự án cần đặt secret SCIATLAS_API_KEY cho worker rồi thử lại.',
  auth: 'SciAtlas từ chối token của lab (sai hoặc đã bị khoá). Chủ dự án cần kiểm tra token SciAtlas.',
  quota: 'Đã dùng hết lượt tra cứu SciAtlas trong ngày. Hãy thử lại vào ngày mai.',
  timeout: 'SciAtlas phản hồi quá lâu. Hãy thử lại sau.',
  bad_request: 'Yêu cầu chưa hợp lệ: cần ít nhất một keyword hoặc title.',
  network: 'Không kết nối được máy chủ lab.',
  error: 'SciAtlas đang gặp lỗi. Hãy thử lại sau.',
};

export class SciAtlasError extends Error {
  constructor(
    public code: SciAtlasErrorCode,
    public detail = '',
  ) {
    super(MESSAGES[code]);
  }
}

const ErrorBodySchema = z.looseObject({ error: z.string().optional(), message: z.string().optional() });

function codeOf(status: number, error: string | undefined): SciAtlasErrorCode {
  if (error === 'sciatlas_not_configured') return 'not_configured';
  if (error === 'sciatlas_auth') return 'auth';
  if (error === 'sciatlas_quota' || status === 429) return 'quota';
  if (error === 'sciatlas_timeout' || status === 504) return 'timeout';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'bad_request';
  return 'error';
}

/** Related papers from SciAtlas through the lab worker. Nothing is stored. */
export async function searchSciAtlas(
  request: SciAtlasSearchRequest,
  token: string | null,
  signal?: AbortSignal,
): Promise<SciAtlasSearchResponse> {
  if (!token) throw new SciAtlasError('signed_out');
  let response: Response;
  try {
    response = await fetch(`${PDF_WORKER_URL}/v1/sciatlas/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new SciAtlasError('network', String(cause));
  }
  if (!response.ok) {
    const body = ErrorBodySchema.safeParse(await response.json().catch(() => ({})));
    const error = body.success ? body.data.error : undefined;
    const message = body.success ? body.data.message : undefined;
    throw new SciAtlasError(
      codeOf(response.status, error),
      [`HTTP ${response.status}`, error, message].filter(Boolean).join(' · '),
    );
  }
  const parsed = SciAtlasSearchResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new SciAtlasError('error', 'Unexpected response shape.');
  return parsed.data;
}
