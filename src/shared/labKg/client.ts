import type { SciAtlasSearchRequest } from '@/core/openkg';
import {
  KG_INGEST_LIMIT,
  KgIngestResultSchema,
  KgGraphSchema,
  KgIngestStatusSchema,
  KgKeywordDetailSchema,
  KgPaperDetailSchema,
  KgSearchResponseSchema,
  KgStatsSchema,
  KgTrendSchema,
  kgIdentifier,
  paperId,
  type KgGraphLayer,
  type KgIngestResult,
  type KgIngestSource,
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
    response = await fetch(`${PDF_WORKER_URL}/v1/kg${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init?.headers },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
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
          : response.status === 400 && path === '/search'
            ? 'Yêu cầu chưa hợp lệ: cần ít nhất một keyword hoặc title.'
            : response.status === 404
              ? 'KG của lab chưa có mục này.'
              : 'Yêu cầu tới KG của lab gặp lỗi.';
  throw new LabKgError(message, [`HTTP ${response.status}`, code].filter(Boolean).join(' · '));
}

/** Sends ids to the ingest queue. A SciAtlas pointer is queued at depth 0: only the work itself is fetched. */
export async function enqueueLabKg(ids: string[], token: string | null, source: KgIngestSource = 'seed') {
  const result: KgIngestResult = { queued: 0, processed: 0, skipped: 0, errors: [] };
  for (let i = 0; i < ids.length; i += KG_INGEST_LIMIT) {
    const raw = await request('/ingest', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ids.slice(i, i + KG_INGEST_LIMIT),
        ...(source === 'seed' ? {} : { source, depth: 0 }),
      }),
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
  const parsed = KgIngestStatusSchema.safeParse(await request('/ingest/status', token, { signal }));
  if (!parsed.success)
    throw new LabKgError('Không đọc được trạng thái KG của lab.', 'Invalid ingest status.');
  return parsed.data;
}

/** Related papers from the lab KG, in the SciAtlas result shape. */
export async function searchLabKg(
  request_: SciAtlasSearchRequest,
  token: string | null,
  signal?: AbortSignal,
) {
  const parsed = KgSearchResponseSchema.safeParse(
    await request('/search', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request_),
      signal,
    }),
  );
  if (!parsed.success)
    throw new LabKgError('Không đọc được kết quả tìm trong KG của lab.', 'Invalid search response.');
  return parsed.data;
}

export async function getLabKgStats(token: string | null, signal?: AbortSignal) {
  const parsed = KgStatsSchema.safeParse(await request('/stats', token, { signal }));
  if (!parsed.success) throw new LabKgError('Không đọc được số liệu KG của lab.', 'Invalid stats response.');
  return parsed.data;
}

/** The neighbourhood of one KG node (`W…`, `keywords/…`, `topics/…`, `A…`), ranked and capped by the worker. */
export async function getLabKgGraph(
  options: { centre: string; depth: 1 | 2; layers: readonly KgGraphLayer[]; limit?: number },
  token: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    center: options.centre,
    depth: String(options.depth),
    layers: options.layers.join(','),
  });
  if (options.limit) query.set('limit', String(options.limit));
  const parsed = KgGraphSchema.safeParse(await request(`/graph?${query.toString()}`, token, { signal }));
  if (!parsed.success) throw new LabKgError('Không đọc được đồ thị KG của lab.', 'Invalid graph response.');
  return parsed.data;
}

export async function getLabKgTrend(keywords: string[], token: string | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ keywords: keywords.join(',') });
  const parsed = KgTrendSchema.safeParse(await request(`/trend?${query.toString()}`, token, { signal }));
  if (!parsed.success) throw new LabKgError('Không đọc được xu hướng keyword.', 'Invalid trend response.');
  return parsed.data;
}

export async function getLabKgPaper(id: string, token: string | null, signal?: AbortSignal) {
  const parsed = KgPaperDetailSchema.safeParse(
    await request(`/papers/${encodeURIComponent(id)}`, token, { signal }),
  );
  if (!parsed.success)
    throw new LabKgError('Không đọc được bài trong KG của lab.', 'Invalid paper response.');
  return parsed.data;
}

export async function getLabKgKeyword(id: string, token: string | null, signal?: AbortSignal) {
  const parsed = KgKeywordDetailSchema.safeParse(
    await request(`/keywords/${encodeURIComponent(id)}`, token, { signal }),
  );
  if (!parsed.success)
    throw new LabKgError('Không đọc được keyword trong KG của lab.', 'Invalid keyword response.');
  return parsed.data;
}
