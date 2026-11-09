import type { LibraryItem } from '../schemas/library';

export type LibraryStatus = 'pending' | 'file' | 'open' | 'none_found' | 'unknown' | 'not_found' | 'failed';

export function libraryStatus(item: LibraryItem): LibraryStatus {
  if (item.paper_id) return 'file';
  if (item.lookup !== 'done') return item.lookup;
  return item.access === 'open' ? 'open' : item.access;
}

export interface LibraryFilter {
  status: LibraryStatus | 'all';
  domain: string;
  field: string;
  topic: string;
  query: string;
}
export const EMPTY_FILTER: LibraryFilter = { status: 'all', domain: '', field: '', topic: '', query: '' };

export function filterLibrary(items: LibraryItem[], filter: LibraryFilter) {
  const term = filter.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filter.status === 'all' || libraryStatus(item) === filter.status) &&
      (!filter.domain || item.taxonomy?.domain === filter.domain) &&
      (!filter.field || item.taxonomy?.field === filter.field) &&
      (!filter.topic || item.taxonomy?.topic === filter.topic) &&
      (!term ||
        item.doi.includes(term) ||
        (item.title ?? '').toLowerCase().includes(term) ||
        item.authors.some((author) => author.toLowerCase().includes(term))),
  );
}

export interface Facet {
  value: string;
  count: number;
}
const facet = (values: (string | null | undefined)[]): Facet[] => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};

/** Each level narrows the next, so a choice can never lead to an empty list. */
export function taxonomyFacets(items: LibraryItem[], filter: Pick<LibraryFilter, 'domain' | 'field'>) {
  const inDomain = items.filter((item) => !filter.domain || item.taxonomy?.domain === filter.domain);
  const inField = inDomain.filter((item) => !filter.field || item.taxonomy?.field === filter.field);
  return {
    domains: facet(items.map((item) => item.taxonomy?.domain)),
    fields: facet(inDomain.map((item) => item.taxonomy?.field)),
    topics: facet(inField.map((item) => item.taxonomy?.topic)),
  };
}

export function statusCounts(items: LibraryItem[]) {
  const counts: Partial<Record<LibraryStatus, number>> = {};
  for (const item of items) {
    const status = libraryStatus(item);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/** The best address to open: a direct PDF first, otherwise the landing page. */
export function bestOpenLink(item: LibraryItem) {
  for (const source of item.oa_sources) if (source.pdf_url) return source.pdf_url;
  return item.oa_sources[0]?.landing_url ?? null;
}

const risLine = (tag: string, value: string) => `${tag}  - ${value.replace(/\s+/gu, ' ').trim()}`;

export function toRis(items: LibraryItem[]) {
  return items
    .map((item) =>
      [
        risLine('TY', 'JOUR'),
        ...(item.title ? [risLine('TI', item.title)] : []),
        ...item.authors.map((author) => risLine('AU', author)),
        ...(item.year ? [risLine('PY', String(item.year))] : []),
        ...(item.venue ? [risLine('JO', item.venue)] : []),
        risLine('DO', item.doi),
        risLine('UR', `https://doi.org/${item.doi}`),
        'ER  - ',
      ].join('\r\n'),
    )
    .join('\r\n\r\n')
    .concat(items.length ? '\r\n' : '');
}
