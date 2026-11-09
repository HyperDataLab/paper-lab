import {
  mapCrossref,
  mapEuropePmc,
  mapOpenAlex,
  mapUnpaywall,
  mergeLookups,
  type CrossrefLookup,
  type LookupPatch,
  type OaLookup,
  type OpenAlexLookup,
} from '@/core/library';
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
  return { lookupDoi, downloadArxivPdf };
}
export type ScholarClient = ReturnType<typeof createScholarClient>;
