import type { z } from 'zod';
import {
  HubErrorResponse,
  HubPdfResponse,
  HubRequestsResponse,
  HubStatusResponse,
} from '@/core/schemas/fetchHub';

export const FETCH_HUB_URL = ((import.meta.env.VITE_FETCH_HUB_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/u, '');

const SIGN_IN_REQUIRED = 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại vào PaperLab.';
const ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'DOI hoặc dữ liệu gửi đến Paper Fetch Hub không hợp lệ.',
  401: SIGN_IN_REQUIRED,
  403: 'Tài khoản này không được phép dùng Paper Fetch Hub của lab.',
  409: 'Paper Fetch Hub chưa có PDF sẵn sàng. Hãy cập nhật lại trạng thái.',
  413: 'Mỗi yêu cầu đến Paper Fetch Hub chỉ nhận tối đa 500 mục.',
  429: 'Đã chạm giới hạn yêu cầu của Paper Fetch Hub. Hãy thử lại sau.',
  503: 'Paper Fetch Hub chưa sẵn sàng cho PaperLab. Hãy thử lại sau.',
};

export class FetchHubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export function createFetchHubClient({
  baseUrl,
  getToken,
  fetch: fetcher = (input, init) => globalThis.fetch(input, init),
}: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}) {
  const url = baseUrl.trim().replace(/\/+$/u, '');
  async function post<T>(
    path: 'requests' | 'status' | 'pdf',
    body: object,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ) {
    if (!url) throw new FetchHubError(0, 'Chưa cấu hình Paper Fetch Hub.');
    signal?.throwIfAborted();
    const token = await getToken().catch(() => null);
    signal?.throwIfAborted();
    if (!token) throw new FetchHubError(401, SIGN_IN_REQUIRED);
    let response: Response;
    try {
      response = await fetcher(`${url}/lab/v1/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      signal?.throwIfAborted();
      throw new FetchHubError(0, 'Không thể kết nối với Paper Fetch Hub. Hãy thử lại sau.');
    }
    const data: unknown = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok) {
      const parsed = HubErrorResponse.safeParse(data);
      const message =
        response.status === 409 && path === 'requests'
          ? 'Yêu cầu vừa thay đổi trên Paper Fetch Hub. Hãy gửi lại danh sách DOI.'
          : (ERROR_MESSAGES[response.status] ?? 'Paper Fetch Hub không xử lý được yêu cầu. Hãy thử lại sau.');
      throw new FetchHubError(
        response.status,
        message,
        parsed.success ? `HTTP ${response.status} · ${parsed.data.error}` : `HTTP ${response.status}`,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new FetchHubError(response.status, 'Phản hồi từ Paper Fetch Hub không đúng định dạng.', path);
    return parsed.data;
  }

  // Sequential batches keep the worker's cap and stop promptly if a request fails.
  async function batch<Item, Result>(items: readonly Item[], run: (chunk: Item[]) => Promise<Result[]>) {
    const results: Result[] = [];
    for (let i = 0; i < items.length; i += 500) {
      results.push(...(await run(items.slice(i, i + 500))));
    }
    return results;
  }

  return {
    requestDois(items: readonly { doi: string; tag: string }[], signal?: AbortSignal) {
      return batch(
        items,
        async (chunk) => (await post('requests', { items: chunk }, HubRequestsResponse, signal)).results,
      );
    },
    status(doiKeys: readonly string[], signal?: AbortSignal) {
      return batch(
        doiKeys,
        async (chunk) => (await post('status', { doiKeys: chunk }, HubStatusResponse, signal)).papers,
      );
    },
    pdf(doiKey: string, signal?: AbortSignal) {
      return post('pdf', { doiKey }, HubPdfResponse, signal);
    },
  };
}
