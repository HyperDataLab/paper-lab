import { z } from 'zod';
import { OPENALEX_WORK_SELECT } from '../../../src/core/labKg';
import { KG_CITED_BY_TOP_N, paperId } from '../../../src/core/schemas/labKg';

export class OpenAlexError extends Error {
  constructor(
    public code: string,
    public retry = true,
    public retryAfter: string | null = null,
  ) {
    super(code);
  }
}

const CitingWorksSchema = z.object({ results: z.array(z.object({ id: z.string() })) });

export function openAlexClient(fetcher: typeof fetch, mailto?: string, apiKey?: string) {
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://api.openalex.org/works${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (mailto?.trim()) url.searchParams.set('mailto', mailto.trim());
    if (apiKey?.trim()) url.searchParams.set('api_key', apiKey.trim());
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new OpenAlexError('openalex_unavailable');
    }
    if (response.status === 429)
      throw new OpenAlexError('openalex_rate_limited', true, response.headers.get('retry-after'));
    if (response.status === 404) throw new OpenAlexError('openalex_not_found', false);
    if (!response.ok) throw new OpenAlexError('openalex_unavailable');
    try {
      return await response.json();
    } catch {
      throw new OpenAlexError('openalex_invalid_response');
    }
  }
  return {
    work: (id: string) =>
      get(`/${paperId(id) ?? `https://doi.org/${encodeURIComponent(id)}`}`, { select: OPENALEX_WORK_SELECT }),
    async citing(id: string) {
      const raw = await get('', {
        select: 'id',
        filter: `cites:${id}`,
        sort: 'cited_by_count:desc',
        'per-page': String(KG_CITED_BY_TOP_N),
      });
      const result = CitingWorksSchema.safeParse(raw);
      if (!result.success) throw new OpenAlexError('openalex_invalid_response');
      return result.data.results.map((item) => item.id);
    },
  };
}
