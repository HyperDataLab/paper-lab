import { z } from 'zod';

export const LAB_RESEARCH_URL: string = (import.meta.env.VITE_LAB_RESEARCH_URL as string | undefined) ?? '';
export type LabResearchErrorCode =
  'network' | 'signed_out' | 'not_configured' | 'rate_limited' | 'invalid_input' | 'upstream' | 'failed';
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
export function createLabResearchClient(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    async callTool(name: string, input: unknown): Promise<unknown> {
      if (!options.baseUrl.trim())
        throw new LabResearchError(0, 'not_configured', 'Lab research server is not configured.');
      const token = await options.getToken();
      if (!token) throw new LabResearchError(401, 'signed_out', 'Not signed in.');
      let response: Response;
      try {
        response = await fetcher(
          `${options.baseUrl.replace(/\/$/u, '')}/v1/tools/${encodeURIComponent(name)}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          },
        );
      } catch {
        throw new LabResearchError(0, 'network', 'Network request failed.');
      }
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success || !parsed.data.ok) {
        const code: LabResearchErrorCode =
          response.status === 401
            ? 'signed_out'
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
