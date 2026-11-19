import type { SciAtlasSearchRequest } from '@/core/openkg';
import {
  KG_INGEST_LIMIT,
  KgIngestResultSchema,
  KgGraphSchema,
  KgIngestStatusSchema,
  KgKeywordDetailSchema,
  KgOverviewSchema,
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
    /** The HTTP status, when the server answered. */
    public status?: number,
    /** The server's error code, such as `not_found` or `kg_not_configured`. */
    public code = '',
  ) {
    super(message);
  }
}

/** A thrown value as a `LabKgError`, keeping an unexpected error's message as its technical detail. */
export const asLabKgError = (cause: unknown, fallback: string) =>
  cause instanceof LabKgError
    ? cause
    : new LabKgError(fallback, cause instanceof Error && cause.message ? cause.message : '');

function errorMessage(status: number, code: string, path: string) {
  if (code === 'kg_not_configured') return 'KG của lab chưa được cấu hình trên máy chủ lab.';
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Tài khoản này không được dùng KG của lab.';
  if (status === 400 && path === '/search') return 'Yêu cầu chưa hợp lệ: cần ít nhất một keyword hoặc title.';
  if (status === 400) return 'Yêu cầu tới KG của lab chưa hợp lệ.';
  if (status === 404) return 'KG của lab chưa có mục này.';
  if (status === 429) return 'Máy chủ lab đang bận. Hãy thử lại sau ít phút.';
  if (status >= 500) return `Máy chủ KG của lab gặp lỗi (HTTP ${status}).`;
  return `Yêu cầu tới KG của lab gặp lỗi (HTTP ${status}).`;
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
  const url = `${PDF_WORKER_URL}/v1/kg${path}`;
  const send = async (cache?: RequestCache) => {
    try {
      return await fetch(url, {
        ...init,
        ...(cache ? { cache } : {}),
        headers: { Authorization: `Bearer ${token}`, ...init?.headers },
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new LabKgError(
        'Không kết nối được máy chủ lab. Hãy kiểm tra mạng rồi thử lại.',
        `Network error${cause instanceof Error && cause.message ? `: ${cause.message}` : ''}`,
      );
    }
  };
  let response = await send();
  if (response.status === 304) {
    // Read routes answer 304 to a matching If-None-Match. The browser normally hides that behind its cache;
    // a 304 that reaches us has no body, so ask again without revalidation.
    response = await send('reload');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const code =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
  throw new LabKgError(
    errorMessage(response.status, code, path),
    [`HTTP ${response.status}`, code].filter(Boolean).join(' · '),
    response.status,
    code,
  );
}

/** Sends ids to the ingest queue. A SciAtlas pointer is queued at depth 0: only the work itself is fetched. */
export async function enqueueLabKg(
  ids: string[],
  token: string | null,
  source: KgIngestSource = 'seed',
  /** Called after each batch with the combined result so far and how many ids were sent. */
  onProgress?: (result: KgIngestResult, sent: number) => void,
) {
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
    onProgress?.({ ...result, errors: [...result.errors] }, Math.min(ids.length, i + KG_INGEST_LIMIT));
  }
  return result;
}

export async function getLabKgOverview(token: string | null, signal?: AbortSignal) {
  const parsed = KgOverviewSchema.safeParse(await request('/overview', token, { signal }));
  if (!parsed.success)
    throw new LabKgError('Không đọc được điểm bắt đầu trong KG của lab.', 'Invalid overview response.');
  return parsed.data;
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
