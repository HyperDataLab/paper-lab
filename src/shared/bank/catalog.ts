import { BankCatalogSnapshotSchema, type BankArticleType } from '@/core/schemas/bankCatalog';
import { BANK_API_URL, BankApiError, createBankClient } from './bankApi';

export type BankCatalog = {
  status: 'ok';
  release: string;
  articleTypes: BankArticleType[];
};
export type BankCatalogResult =
  | BankCatalog
  | {
      status: 'unavailable';
      reason: 'collections_missing' | 'network' | 'signed_out' | 'invalid' | 'request_failed';
    };

export function createBankCatalogClient({
  baseUrl = BANK_API_URL,
  fetch: fetcher,
}: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  // Only the newest release is requested. Keep its validated data for the next conditional request.
  let cached: BankCatalog | undefined;
  return async (getToken: () => Promise<string | null>): Promise<BankCatalogResult> => {
    const known = cached;
    try {
      const response = await createBankClient({ baseUrl, getToken, fetch: fetcher }).getSnapshot(
        known?.release,
        'article-types',
      );
      if (response.status === 'current') return known ?? { status: 'unavailable', reason: 'invalid' };
      const parsed = BankCatalogSnapshotSchema.safeParse(
        JSON.parse(new TextDecoder().decode(response.bytes)),
      );
      if (!parsed.success) return { status: 'unavailable', reason: 'invalid' };
      const { release, collections } = parsed.data;
      cached = {
        status: 'ok',
        release,
        articleTypes: collections['article-types'],
      };
      return cached;
    } catch (error) {
      if (error instanceof SyntaxError) return { status: 'unavailable', reason: 'invalid' };
      if (!(error instanceof BankApiError) || error.status === 0)
        return { status: 'unavailable', reason: 'network' };
      if (error.status === 401) return { status: 'unavailable', reason: 'signed_out' };
      if (error.status === 400 && error.code === 'bad_request')
        return { status: 'unavailable', reason: 'collections_missing' };
      return { status: 'unavailable', reason: 'request_failed' };
    }
  };
}

export const getBankCatalog = createBankCatalogClient();
