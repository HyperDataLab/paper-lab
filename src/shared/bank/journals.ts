import { BankJournalPageSchema, type BankJournalPage } from '@/core/schemas/bankCatalog';
import { BANK_API_URL, BankApiError, createBankClient } from './bankApi';

export const JOURNAL_SEARCH_LIMIT = 20;
const CACHE_LIMIT = 20;

export type BankJournalSearch =
  | ({ status: 'ok' } & BankJournalPage)
  | {
      status: 'unavailable';
      reason: 'missing_route' | 'network' | 'signed_out' | 'invalid' | 'request_failed';
    };

export function createJournalSearchClient({
  baseUrl = BANK_API_URL,
  fetch: fetcher,
}: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const cache = new Map<string, { etag: string; page: BankJournalPage }>();
  return async (
    getToken: () => Promise<string | null>,
    query: string,
    {
      limit = JOURNAL_SEARCH_LIMIT,
      cursor,
      signal,
    }: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<BankJournalSearch> => {
    const term = query.trim();
    const params = new URLSearchParams();
    if (/^\d{4}-?\d{3}[\dX]$/iu.test(term)) params.set('issn', term.toUpperCase());
    else if (/^S\d+$/iu.test(term)) params.set('openalex', term.toUpperCase());
    else params.set('q', term);
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const key = params.toString();
    const cached = cache.get(key);
    try {
      const response = await createBankClient({ baseUrl, getToken, fetch: fetcher }).getJournals(
        params,
        cached?.etag ?? null,
        signal,
      );
      signal?.throwIfAborted();
      if (!response) {
        return cached ? { status: 'ok', ...cached.page } : { status: 'unavailable', reason: 'invalid' };
      }
      const parsed = BankJournalPageSchema.safeParse(await response.json());
      signal?.throwIfAborted();
      if (!parsed.success) return { status: 'unavailable', reason: 'invalid' };
      const etag = response.headers.get('ETag');
      cache.delete(key);
      if (etag) {
        cache.set(key, { etag, page: parsed.data });
        const oldest = cache.keys().next().value;
        if (cache.size > CACHE_LIMIT && oldest !== undefined) cache.delete(oldest);
      }
      return { status: 'ok', ...parsed.data };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof SyntaxError) return { status: 'unavailable', reason: 'invalid' };
      if (!(error instanceof BankApiError) || error.status === 0)
        return { status: 'unavailable', reason: 'network' };
      if (error.status === 404) return { status: 'unavailable', reason: 'missing_route' };
      if (error.status === 401) return { status: 'unavailable', reason: 'signed_out' };
      return { status: 'unavailable', reason: 'request_failed' };
    }
  };
}

export const searchBankJournals = createJournalSearchClient();
