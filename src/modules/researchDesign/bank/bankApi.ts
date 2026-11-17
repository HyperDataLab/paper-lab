import { z } from 'zod';

export const BANK_API_URL: string =
  (import.meta.env.VITE_BANK_API_URL as string | undefined) ||
  'https://writingbank-worker.hyperdatalab.workers.dev';

export const SNAPSHOT_COLLECTIONS = 'designs,threats,claim-types,metrics,protocols,benchmarks';

/** A failed Writing Bank call: the HTTP status (0 when the network failed) and the API's `{ error, message }`. */
export class BankApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

const releaseSchema = z.object({
  release: z.string(),
  date: z.string(),
  notes: z.string().default(''),
  includesDrafts: z.boolean().default(false),
});
export type BankRelease = z.infer<typeof releaseSchema>;

/** Only a bank release has an ETag on the API (`"<release>"`); a hash release of an imported file does not. */
const bankRelease = (release: string | null) =>
  release && /^\d{4}\.\d{2}\.[1-9]\d*$/.test(release) ? release : null;

export function createBankClient(options: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function get(path: string, known: string | null): Promise<Response | null> {
    const token = await options.getToken();
    if (!token) throw new BankApiError(401, 'signed_out', 'Not signed in.');
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const etag = bankRelease(known);
    if (etag) headers['If-None-Match'] = `"${etag}"`;
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/bank/v1${path}`, {
        method: 'GET',
        headers,
      });
    } catch {
      throw new BankApiError(0, 'network', 'Network request failed.');
    }
    if (response.status === 304) return null;
    if (!response.ok) {
      const body = z
        .object({ error: z.string(), message: z.string() })
        .safeParse(await response.json().catch(() => null));
      const retry = response.headers.get('Retry-After');
      throw new BankApiError(
        response.status,
        body.success ? body.data.error : 'unknown',
        body.success ? body.data.message : `HTTP ${response.status}`,
        response.status === 429 && retry && /^\d+$/.test(retry) ? Number(retry) : null,
      );
    }
    return response;
  }
  return {
    /** The newest release, or `current` when it is the one the project holds (304). */
    async getRelease(known: string | null = null) {
      const response = await get('/release', known);
      if (!response) return { status: 'current' as const };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new BankApiError(response.status, 'invalid', 'The release is not JSON.');
      }
      const parsed = releaseSchema.safeParse(body);
      if (!parsed.success) throw new BankApiError(response.status, 'invalid', 'The release is not valid.');
      return { status: 'release' as const, release: parsed.data };
    },
    /** The raw bytes of the newest snapshot, or `current` when the project holds it (304). */
    async getSnapshot(known: string | null = null) {
      const response = await get(`/snapshot?collections=${SNAPSHOT_COLLECTIONS}`, known);
      if (!response) return { status: 'current' as const };
      try {
        return { status: 'snapshot' as const, bytes: await response.arrayBuffer() };
      } catch {
        throw new BankApiError(0, 'network', 'Network request failed.');
      }
    },
  };
}
export type BankClient = ReturnType<typeof createBankClient>;
