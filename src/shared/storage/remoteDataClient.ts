import { z } from 'zod';
import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';
import {
  DataNotConfiguredError,
  RemoteStorageError,
  StorageConflictError,
  UniqueConflictError,
} from './errors';

const version = z.number().int().positive();
const ref = z.object({ collection: z.string(), id: z.string() });
const meta = z.object({
  id: z.string(),
  version,
  summary: z.record(z.string(), z.unknown()),
  body: z.unknown().optional(),
});
const queryPage = z.object({ items: z.array(meta), nextCursor: z.string().nullable() });
const batchPage = z.object({
  items: z.array(meta),
  missing: z.array(z.string()),
  deferred: z.array(z.string()),
});
export type DocRef = z.output<typeof ref>;
const refsPage = z.object({
  items: z.array(meta.extend({ collection: z.string() })),
  deferred: z.array(ref),
});
const commitResult = z.object({ results: z.array(ref.extend({ version })) });
const writeResult = z.object({ version });
const legacyCorporaPage = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
});
const errorBody = z.object({
  error: z.string(),
  message: z.string().optional(),
  serverVersion: version.nullable().optional(),
  conflicts: z.array(ref.extend({ serverVersion: version.nullable() })).optional(),
});
const etag = (value: number) => `"v${value}"`;

export interface RemoteDataOptions {
  getToken: () => Promise<string | null>;
  projectId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  onConfigurationError?: (message: string | null) => void;
}

export class RemoteDataClient {
  constructor(private readonly options: RemoteDataOptions) {}

  private async request(
    path: string,
    {
      method = 'GET',
      body,
      headers,
      target,
      onSend,
      prepareBody,
    }: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      target?: z.output<typeof ref>;
      onSend?: () => void;
      prepareBody?: () => unknown;
    } = {},
  ) {
    const token = await this.options.getToken();
    if (!token) throw new RemoteStorageError(401, 'sign_in_required', 'Phiên đăng nhập đã hết hạn.');
    const url = (this.options.baseUrl ?? PDF_WORKER_URL).replace(/\/$/u, '');
    const send = this.options.fetch ?? fetch;
    const payload = JSON.stringify(prepareBody ? prepareBody() : body);
    onSend?.();
    const response = await send(projectScopedUrl(`${url}/v1/data/${path}`, this.options.projectId), {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Project-Id': this.options.projectId,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: payload,
    }).catch(() => {
      throw new RemoteStorageError(0, 'network_error', 'Không kết nối được với kho dữ liệu lab.');
    });
    if (response.ok || (method === 'GET' && [304, 404].includes(response.status))) {
      this.options.onConfigurationError?.(null);
      return response;
    }
    const parsed = errorBody.safeParse(await response.json().catch(() => null));
    const detail = parsed.data?.message ?? `Kho dữ liệu lab trả lời HTTP ${response.status}.`;
    if (response.status === 503 && parsed.data?.error === 'data_not_configured') {
      this.options.onConfigurationError?.(detail);
      throw new DataNotConfiguredError(detail);
    }
    if (response.status === 409 && parsed.data?.error === 'unique_conflict')
      throw new UniqueConflictError(detail);
    if (response.status === 409) {
      const conflict = parsed.data?.conflicts?.[0] ?? target;
      throw new StorageConflictError(
        conflict?.collection ?? '',
        conflict?.id ?? '',
        parsed.data?.conflicts?.[0]?.serverVersion ?? parsed.data?.serverVersion ?? null,
      );
    }
    throw new RemoteStorageError(response.status, parsed.data?.error ?? 'http_error', detail);
  }

  private path(collection: string, id: string) {
    return `${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
  }

  async get(collection: string, id: string, cached?: number) {
    const result = await this.request(this.path(collection, id), {
      headers: cached === undefined ? undefined : { 'If-None-Match': etag(cached) },
    });
    if (result.status === 304) return undefined;
    if (result.status === 404) return null;
    // Cloudflare weakens the ETag (W/"v1") when it compresses the response.
    const tag = /^(?:W\/)?"v([1-9]\d*)"$/u.exec(result.headers.get('ETag') ?? '');
    return { doc: (await result.json()) as unknown, version: version.parse(Number(tag?.[1])) };
  }

  async put(
    collection: string,
    id: string,
    prepareBody: () => unknown,
    expected: number | null,
    onSend?: () => void,
  ) {
    const result = await this.request(this.path(collection, id), {
      method: 'PUT',
      prepareBody,
      headers: expected === null ? { 'If-None-Match': '*' } : { 'If-Match': etag(expected) },
      target: { collection, id },
      onSend,
    });
    return writeResult.parse(await result.json()).version;
  }

  async remove(collection: string, id: string, expected: number) {
    await this.request(this.path(collection, id), {
      method: 'DELETE',
      headers: { 'If-Match': etag(expected) },
      target: { collection, id },
    });
  }

  async query(body: object) {
    const result = await this.request('query', { method: 'POST', body });
    return queryPage.parse(await result.json());
  }

  async batch(collection: string, ids: string[]) {
    const result = await this.request('batch-get', { method: 'POST', body: { collection, ids } });
    return batchPage.parse(await result.json());
  }

  async batchRefs(refs: DocRef[]) {
    const result = await this.request('batch-get', { method: 'POST', body: { refs } });
    return refsPage.parse(await result.json());
  }

  async commit(body: object) {
    const result = await this.request('commit', { method: 'POST', body });
    return commitResult.parse(await result.json()).results;
  }

  async importLegacyCorpora(cursor: string | null) {
    const query = cursor === null ? '' : `?${new URLSearchParams({ cursor })}`;
    const result = await this.request(`admin/import-legacy-corpora${query}`, { method: 'POST' });
    return legacyCorporaPage.parse(await result.json());
  }
}
