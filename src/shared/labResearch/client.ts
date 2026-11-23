import { z } from 'zod';

export const LAB_RESEARCH_URL: string = (import.meta.env.VITE_LAB_RESEARCH_URL as string | undefined) ?? '';
export type LabResearchErrorCode =
  | 'network'
  | 'signed_out'
  | 'unauthorized'
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_input'
  | 'upstream'
  | 'failed';
export class LabResearchError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: LabResearchErrorCode,
    message: string,
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), output: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.unknown() }),
]);
const toolsSchema = z.object({
  tools: z.array(
    z.object({ name: z.string(), description: z.string(), input_schema: z.record(z.string(), z.unknown()) }),
  ),
});
export type LabTool = z.infer<typeof toolsSchema>['tools'][number];
export function createLabResearchClient(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function get(path: string, authenticated: boolean) {
    if (!options.baseUrl.trim())
      throw new LabResearchError(0, 'not_configured', 'Lab research server is not configured.');
    const token = authenticated ? await options.getToken() : null;
    if (authenticated && !token) throw new LabResearchError(401, 'signed_out', 'Not signed in.');
    let response: Response;
    try {
      response = await fetcher(
        `${options.baseUrl.replace(/\/$/u, '')}${path}`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      );
    } catch {
      throw new LabResearchError(0, 'network', 'Network request failed.');
    }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      throw new LabResearchError(
        response.status,
        response.status === 401
          ? 'unauthorized'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'upstream'
              : 'failed',
        `HTTP ${response.status}`,
        retry && /^\d+$/u.test(retry) ? Number(retry) : null,
      );
    }
    return response.json().catch(() => null) as Promise<unknown>;
  }
  return {
    async health() {
      const parsed = z.object({ ok: z.literal(true) }).safeParse(await get('/health', false));
      if (!parsed.success) throw new LabResearchError(0, 'failed', 'Invalid health response.');
      return parsed.data;
    },
    async listTools() {
      const parsed = toolsSchema.safeParse(await get('/v1/tools', true));
      if (!parsed.success) throw new LabResearchError(0, 'failed', 'Invalid tools response.');
      return parsed.data.tools;
    },
    async callTool(name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
      if (!options.baseUrl.trim())
        throw new LabResearchError(0, 'not_configured', 'Lab research server is not configured.');
      const token = await options.getToken();
      if (!token) throw new LabResearchError(401, 'signed_out', 'Not signed in.');
      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await fetcher(
          `${options.baseUrl.replace(/\/$/u, '')}/v1/tools/${encodeURIComponent(name)}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            ...(signal && { signal }),
          },
        );
      } catch {
        signal?.throwIfAborted();
        throw new LabResearchError(0, 'network', 'Network request failed.');
      }
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success || !parsed.data.ok) {
        const code: LabResearchErrorCode =
          response.status === 401
            ? 'unauthorized'
            : response.status === 429
              ? 'rate_limited'
              : response.status === 400
                ? 'invalid_input'
                : response.status >= 500
                  ? 'upstream'
                  : 'failed';
        const retry = response.headers.get('Retry-After');
        const error = parsed.success && !parsed.data.ok ? parsed.data.error : null;
        const message = typeof error === 'string' ? error : `HTTP ${response.status}`;
        throw new LabResearchError(
          response.status,
          code,
          message,
          retry && /^\d+$/u.test(retry) ? Number(retry) : null,
        );
      }
      return parsed.data.output;
    },
  };
}

export function labResearchErrorMessage(error: unknown): string {
  if (!(error instanceof LabResearchError)) return 'Không thể chạy công cụ nghiên cứu.';
  switch (error.code) {
    case 'not_configured':
      return 'Máy chủ nghiên cứu của lab chưa được cấu hình.';
    case 'signed_out':
      return 'Đăng nhập tài khoản lab để chạy công cụ.';
    case 'unauthorized':
      return 'Lab Research Worker từ chối phiên SSO hiện tại. Hãy đăng nhập lại; nếu vẫn lỗi, cần kiểm tra cấu hình xác thực của Worker.';
    case 'network':
      return 'Không thể kết nối máy chủ nghiên cứu.';
    case 'rate_limited':
      return `Quá nhiều yêu cầu. Thử lại sau ${error.retryAfter ?? 0} giây.`;
    case 'invalid_input':
      return 'Dữ liệu gửi tới công cụ không hợp lệ.';
    case 'upstream':
      return 'Dịch vụ nghiên cứu đang gặp sự cố.';
    case 'failed':
      return 'Không thể chạy công cụ nghiên cứu.';
  }
}
