import {
  KG_INGEST_LIMIT,
  KgIngestResultSchema,
  KgIngestStatusSchema,
  kgIdentifier,
  paperId,
  type KgIngestResult,
} from '@/core/schemas/labKg';
import { PDF_WORKER_URL } from '@/shared/pdfStore';

export class LabKgError extends Error {
  constructor(
    message: string,
    public detail = '',
  ) {
    super(message);
  }
}

export function labKgIds(records: Iterable<{ openalexId?: string | null; doi?: string | null }>) {
  return [
    ...new Set(
      [...records].flatMap(({ openalexId, doi }) => paperId(openalexId) ?? kgIdentifier(doi ?? '') ?? []),
    ),
  ];
}

async function request(path: string, token: string | null, init?: RequestInit): Promise<unknown> {
  if (!token) throw new LabKgError('Hãy đăng nhập bằng tài khoản lab để dùng KG.');
  let response: Response;
  try {
    response = await fetch(`${PDF_WORKER_URL}/v1/kg/ingest${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init?.headers },
    });
  } catch {
    throw new LabKgError('Không kết nối được máy chủ lab.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const code =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
  const message =
    code === 'kg_not_configured'
      ? 'KG của lab chưa được cấu hình.'
      : response.status === 401
        ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'
        : response.status === 403
          ? 'Tài khoản này không được dùng KG của lab.'
          : 'Yêu cầu tới KG của lab gặp lỗi.';
  throw new LabKgError(message, [`HTTP ${response.status}`, code].filter(Boolean).join(' · '));
}

export async function enqueueLabKg(ids: string[], token: string | null) {
  const result: KgIngestResult = { queued: 0, processed: 0, skipped: 0, errors: [] };
  for (let i = 0; i < ids.length; i += KG_INGEST_LIMIT) {
    const raw = await request('', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(i, i + KG_INGEST_LIMIT) }),
    });
    const parsed = KgIngestResultSchema.safeParse(raw);
    if (!parsed.success)
      throw new LabKgError('Không đọc được kết quả đưa bài vào KG.', 'Invalid ingest response.');
    const { queued, processed, skipped, errors } = parsed.data;
    result.queued += queued;
    result.processed += processed;
    result.skipped += skipped;
    result.errors.push(...errors);
  }
  return result;
}

export async function getLabKgStatus(token: string | null, signal?: AbortSignal) {
  const parsed = KgIngestStatusSchema.safeParse(await request('/status', token, { signal }));
  if (!parsed.success)
    throw new LabKgError('Không đọc được trạng thái KG của lab.', 'Invalid ingest status.');
  return parsed.data;
}
