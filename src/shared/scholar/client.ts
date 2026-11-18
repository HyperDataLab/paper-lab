import {
  mapCrossref,
  mapEuropePmc,
  mapOpenAlex,
  mapOpenAlexKeywords,
  mapUnpaywall,
  mergeLookups,
  type CrossrefLookup,
  type LookupPatch,
  type OaLookup,
  type OpenAlexLookup,
} from '@/core/library';
import {
  abstractFromIndex,
  mapPaperMetadata,
  mapWorkStatuses,
  type WorkStatus,
} from '@/core/scholarlyContext';
import { guardPaperSize } from '@/shared/paper/sizeGuard';

type Deps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void> };
const defaults: Deps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export class ScholarHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
const STATUS_BATCH = 50;
export type LookupOutcome = { found: true; patch: LookupPatch } | { found: false };

export function createScholarClient(options: { email?: string | null }, deps: Deps = defaults) {
  /** Returns null when the record does not exist. Throttling and server errors are retried with backoff. */
  async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const response = await deps.fetch(url, { signal });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      if (attempt >= 2 || (response.status !== 429 && response.status < 500))
        throw new ScholarHttpError(response.status);
      const seconds = Number(response.headers.get('Retry-After'));
      await deps.sleep(seconds > 0 ? seconds * 1000 : 800 * 2 ** attempt);
    }
  }
  const path = (doi: string) => encodeURIComponent(doi);

  /**
   * Semantic Scholar corpus id of a DOI, the join key to SCG. Only the DOI is sent. Null when S2 does not
   * know the DOI; a rate limit that outlasts the retries throws `ScholarHttpError`.
   */
  async function lookupS2CorpusId(doi: string, signal?: AbortSignal): Promise<string | null> {
    // S2 reads the DOI as path segments, so the slashes stay as they are.
    const segments = doi.trim().split('/').map(encodeURIComponent).join('/');
    const raw = await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${segments}?fields=corpusId`,
      signal,
    );
    if (!raw || typeof raw !== 'object' || !('corpusId' in raw)) return null;
    const id = raw.corpusId;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  }

  async function lookupDoi(doi: string, signal?: AbortSignal): Promise<LookupOutcome> {
    const work = await getJson(`https://api.openalex.org/works/https://doi.org/${doi}`, signal);
    const openalex: OpenAlexLookup | null = work ? mapOpenAlex(work) : null;
    let crossref: CrossrefLookup | null = null;
    if (!openalex) {
      const record = await getJson(`https://api.crossref.org/works/${path(doi)}`, signal);
      crossref = record ? mapCrossref(record) : null;
      if (!crossref) return { found: false };
    }
    const oa: OaLookup[] = [];
    let incomplete = false;
    // Open-access sources are extras: one being down must not lose the metadata already found.
    const optional = async (url: string, map: (raw: unknown) => OaLookup) => {
      try {
        const raw = await getJson(url, signal);
        if (raw) oa.push(map(raw));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
        incomplete = true;
      }
    };
    // Only Unpaywall requires an email, so only Unpaywall receives it.
    if (options.email)
      await optional(
        `https://api.unpaywall.org/v2/${path(doi)}?email=${encodeURIComponent(options.email)}`,
        mapUnpaywall,
      );
    if (!openalex?.is_open && !oa.some((item) => item.is_open))
      await optional(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=lite`,
        (raw) => mapEuropePmc(raw, doi),
      );
    return { found: true, patch: mergeLookups({ openalex, crossref, oa, incomplete }) };
  }

  /** arXiv is the one common open source that lets a browser download its PDFs directly. */
  async function downloadArxivPdf(arxivId: string, name: string, signal?: AbortSignal) {
    const response = await deps.fetch(`https://arxiv.org/pdf/${arxivId}`, { signal });
    if (!response.ok) throw new ScholarHttpError(response.status);
    const data = await response.arrayBuffer();
    guardPaperSize(data.byteLength);
    if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-')
      throw new Error('arXiv không trả về tệp PDF.');
    return new File([data], name, { type: 'application/pdf' });
  }
  /** Only DOIs leave the browser. A DOI missing from the answer is unknown to OpenAlex, not cleared. */
  async function workStatuses(dois: string[], signal?: AbortSignal) {
    const statuses: WorkStatus[] = [];
    for (let start = 0; start < dois.length; start += STATUS_BATCH) {
      const filter = dois
        .slice(start, start + STATUS_BATCH)
        .map(encodeURIComponent)
        .join('|');
      statuses.push(
        ...mapWorkStatuses(
          await getJson(
            `https://api.openalex.org/works?filter=doi:${filter}&select=doi,title,publication_year,is_retracted&per-page=${STATUS_BATCH}`,
            signal,
          ),
        ),
      );
    }
    return statuses;
  }
  /** Null when OpenAlex has no record of the DOI. */
  async function paperMetadata(doi: string, signal?: AbortSignal) {
    const work = await getJson(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
      signal,
    );
    return work ? mapPaperMetadata(work, new Date().toISOString()) : null;
  }
  /** Only the DOI leaves the browser. Null when OpenAlex has no record of the DOI. */
  async function workKeywords(doi: string, signal?: AbortSignal) {
    const work = (await getJson(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?select=keywords`,
      signal,
    )) as { keywords?: unknown } | null;
    return work ? mapOpenAlexKeywords(work.keywords) : null;
  }
  /** Only the DOI leaves the browser. Null when OpenAlex has no record or no abstract. */
  async function workAbstract(doi: string, signal?: AbortSignal) {
    const work = (await getJson(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?select=abstract_inverted_index`,
      signal,
    )) as { abstract_inverted_index?: unknown } | null;
    return abstractFromIndex(work?.abstract_inverted_index);
  }
  const SEARCH_FIELDS =
    'id,doi,display_name,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count';
  /** Only the query text and filters leave the browser. */
  async function searchWorks(
    query: string,
    options: { fromYear: number | null; toYear: number | null; perPage: number },
    signal?: AbortSignal,
  ) {
    const filters = [
      options.fromYear ? `from_publication_date:${options.fromYear}-01-01` : null,
      options.toYear ? `to_publication_date:${options.toYear}-12-31` : null,
    ].filter(Boolean);
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}${filters.length ? `&filter=${filters.join(',')}` : ''}&per-page=${options.perPage}&select=${SEARCH_FIELDS}`;
    const body = (await getJson(url, signal)) as { results?: unknown[]; meta?: { count?: number } } | null;
    return { results: body?.results ?? [], total: body?.meta?.count ?? 0, url };
  }
  /** One hop along the citation graph: works citing this one, or works it cites. */
  async function citationWorks(
    openalexId: string,
    direction: 'cites' | 'cited_by',
    perPage: number,
    signal?: AbortSignal,
  ) {
    const url = `https://api.openalex.org/works?filter=${direction}:${encodeURIComponent(openalexId)}&sort=cited_by_count:desc&per-page=${perPage}&select=${SEARCH_FIELDS}`;
    const body = (await getJson(url, signal)) as { results?: unknown[] } | null;
    return body?.results ?? [];
  }
  const workId = (value: string) => value.replace(/^https?:\/\/openalex\.org\//iu, '');
  /** The works this one cites, as OpenAlex ids. Only the work id leaves the browser. */
  async function referencedWorks(openalexId: string, signal?: AbortSignal) {
    const url = `https://api.openalex.org/works/${encodeURIComponent(workId(openalexId))}?select=referenced_works`;
    const body = (await getJson(url, signal)) as { referenced_works?: unknown[] } | null;
    const ids = (body?.referenced_works ?? []).filter((v): v is string => typeof v === 'string').map(workId);
    return { ids, url };
  }
  /** Works by OpenAlex id, 50 per request (the OR-filter limit). */
  async function worksByIds(ids: string[], signal?: AbortSignal) {
    const results: unknown[] = [];
    const urls: string[] = [];
    for (let start = 0; start < ids.length; start += STATUS_BATCH) {
      const filter = ids
        .slice(start, start + STATUS_BATCH)
        .map((id) => encodeURIComponent(workId(id)))
        .join('|');
      const url = `https://api.openalex.org/works?filter=openalex_id:${filter}&per-page=${STATUS_BATCH}&select=${SEARCH_FIELDS}`;
      urls.push(url);
      const body = (await getJson(url, signal)) as { results?: unknown[] } | null;
      results.push(...(body?.results ?? []));
    }
    return { results, urls };
  }
  /**
   * Every work citing this one, page by page with a cursor. With a cap, stops once that many are in and says
   * the list was truncated when OpenAlex reported more.
   */
  async function citingWorks(openalexId: string, options: { cap: number | null }, signal?: AbortSignal) {
    const results: unknown[] = [];
    const urls: string[] = [];
    let total = 0;
    let cursor: string | null = '*';
    while (cursor) {
      if (urls.length) await deps.sleep(200);
      const url = `https://api.openalex.org/works?filter=cites:${encodeURIComponent(workId(openalexId))}&per-page=200&select=${SEARCH_FIELDS}&cursor=${encodeURIComponent(cursor)}`;
      urls.push(url);
      const body = (await getJson(url, signal)) as {
        results?: unknown[];
        meta?: { count?: number; next_cursor?: string | null };
      } | null;
      const page = body?.results ?? [];
      total = body?.meta?.count ?? total;
      results.push(...page);
      cursor = page.length ? (body?.meta?.next_cursor ?? null) : null;
      if (options.cap !== null && results.length >= options.cap) break;
    }
    const kept = options.cap === null ? results : results.slice(0, options.cap);
    return { results: kept, total, urls, truncated: options.cap !== null && total > kept.length };
  }
  /** Re-runs a search URL as given (update searches build it); nothing is added to it. */
  async function fetchWorks(url: string, signal?: AbortSignal) {
    const body = (await getJson(url, signal)) as { results?: unknown[]; meta?: { count?: number } } | null;
    return { results: body?.results ?? [], total: body?.meta?.count ?? 0, url };
  }
  async function harvestWorks(url: string, cursor: string, signal?: AbortSignal) {
    await deps.sleep(200);
    const query = new URL(url);
    query.searchParams.set('per-page', '200');
    query.searchParams.set('cursor', cursor);
    const body = (await getJson(query.toString(), signal)) as {
      results?: unknown[];
      meta?: { next_cursor?: string | null };
    } | null;
    return { results: body?.results ?? [], nextCursor: body?.meta?.next_cursor ?? null };
  }
  return {
    lookupS2CorpusId,
    lookupDoi,
    downloadArxivPdf,
    workStatuses,
    paperMetadata,
    workKeywords,
    workAbstract,
    searchWorks,
    citationWorks,
    referencedWorks,
    worksByIds,
    citingWorks,
    fetchWorks,
    harvestWorks,
  };
}
export type ScholarClient = ReturnType<typeof createScholarClient>;
