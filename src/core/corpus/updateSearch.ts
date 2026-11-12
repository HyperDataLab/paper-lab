import type { Candidate, Corpus, CorpusSearch } from '../schemas';
import { recordSearch } from './topic';

type RequestSearch = Extract<CorpusSearch, { requestUrl: string }>;

/** The update round the review is in: 0 until the first "Cập nhật tìm kiếm". */
export const currentRound = (corpus: Corpus) =>
  Math.max(0, ...corpus.searches.map((search) => ('updateRound' in search ? search.updateRound : 0)));

// OpenAlex filter syntax stays readable in the stored URL; everything else is percent-encoded.
const encode = (value: string) =>
  encodeURIComponent(value).replace(/%3A/giu, ':').replace(/%2C/giu, ',').replace(/%7C/giu, '|');
const FROM = 'from_publication_date:';

function withFilter(requestUrl: string, from: string | null) {
  const url = new URL(requestUrl);
  const entries = [...url.searchParams.entries()];
  const filterOf = (value: string) =>
    [
      ...value.split(',').filter((clause) => clause && !clause.startsWith(FROM)),
      ...(from ? [`${FROM}${from}`] : []),
    ].join(',');
  const rest = entries.filter(([key]) => key !== 'filter');
  const filter = filterOf(entries.find(([key]) => key === 'filter')?.[1] ?? '');
  const query = [...(filter ? [['filter', filter] as const] : []), ...rest]
    .sort(([a], [b]) => (a === 'search' ? -1 : b === 'search' ? 1 : 0))
    .map(([key, value]) => `${key}=${encode(value)}`)
    .join('&');
  return `${url.origin}${url.pathname}?${query}`;
}

/** The day after a run, in UTC, as OpenAlex's `from_publication_date` wants it. */
export function dayAfter(at: string): string {
  const day = new Date(`${at.slice(0, 10)}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export type UpdateQuery = { url: string; query: string; lastRunAt: string; from: string };

/**
 * One request per stored OpenAlex query: the same query with `from_publication_date` set to the day after its
 * latest run (across every round), so an update only asks for what was published since.
 */
export function updateQueries(corpus: Corpus): UpdateQuery[] {
  const latest = new Map<string, RequestSearch>();
  for (const search of corpus.searches) {
    if (!('requestUrl' in search) || search.source !== 'openalex') continue;
    const key = withFilter(search.requestUrl, null);
    const seen = latest.get(key);
    if (!seen || search.runAt > seen.runAt) latest.set(key, search);
  }
  return [...latest.entries()].map(([key, search]) => {
    const original = new URL(search.requestUrl).searchParams.get('filter') ?? '';
    const stated = original
      .split(',')
      .find((clause) => clause.startsWith(FROM))
      ?.slice(FROM.length);
    const next = dayAfter(search.runAt);
    const from = stated && stated > next ? stated : next;
    return {
      url: withFilter(key, from),
      query: search.params.search ?? '',
      lastRunAt: search.runAt,
      from,
    };
  });
}

/** An update search is an ordinary OpenAlex entry tagged with its round. */
export function recordUpdateSearch(
  corpus: Corpus,
  candidates: Candidate[],
  result: { url: string; total: number; retrieved: number },
  round: number,
  at: string,
): Corpus {
  return recordSearch(
    corpus,
    candidates,
    {
      requestUrl: result.url,
      totalReported: result.total,
      retrieved: result.retrieved,
      truncated: result.total > result.retrieved,
      updateRound: round,
    },
    at,
  );
}
