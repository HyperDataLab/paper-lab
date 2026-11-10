import { normalizeDoi } from '../library/doi';
import { referenceEntries, paperReferenceParagraphs } from '../paperChecks/references';
import type { Located } from '../paperChecks/common';
import type { Finding, LibraryItem, Paper, PaperMetadata, RetractedWork } from '../schemas';

const DOI_TEXT = /\b10\.\d{4,9}\/[^\s"<>]+/iu;
const NOT_YEARS = /https?:\/\/\S+|\b10\.\d{4,9}\/\S+|arxiv[:\s]\S+/giu;
const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/gu;
export const RECENT_YEARS = 5;

export interface ReferenceItem {
  text: string;
  year: number | null;
  doi: string | null;
  location: Finding['locations'][number] | null;
}

function doiIn(text: string) {
  const match = DOI_TEXT.exec(text);
  return match ? normalizeDoi(match[0]) : null;
}

/** The publication year is usually the last year in an entry. It is an estimate, and shown as one. */
function yearIn(text: string, latest: number) {
  const years = [...text.replace(NOT_YEARS, ' ').matchAll(YEAR)]
    .map((match) => Number(match[0]))
    .filter((year) => year <= latest);
  return years.at(-1) ?? null;
}

/** A PDF line break can end an entry mid-sentence, and the next line then looks like a new author list. */
const isUnfinished = (text: string) => !/(?:[.?!)\]]|\/\S*)\s*$/u.test(text);

export function referenceList(paper: Paper, now = new Date()): ReferenceItem[] {
  const merged: { text: string; first: Located | undefined }[] = [];
  for (const entry of referenceEntries(paperReferenceParagraphs(paper))) {
    const previous = merged.at(-1);
    if (previous && isUnfinished(previous.text)) previous.text += ` ${entry.text}`;
    else merged.push({ text: entry.text, first: entry.locs[0] });
  }
  return merged.map(({ text, first }) => ({
    text,
    year: yearIn(text, now.getFullYear() + 1),
    doi: doiIn(text),
    location: first ? { paragraphId: first.paragraph.id, start: first.start, end: first.end } : null,
  }));
}

export function referenceStats(items: ReferenceItem[]) {
  const years = items.flatMap((item) => (item.year === null ? [] : [item.year])).sort((a, b) => a - b);
  const newest = years.at(-1) ?? null;
  const recent = newest === null ? 0 : years.filter((year) => year > newest - RECENT_YEARS).length;
  const buckets = new Map<number, number>();
  for (const year of years) {
    // Periods count back from the newest year, so the first row is the recent share shown beside it.
    const start =
      (newest ?? year) - RECENT_YEARS * (Math.floor(((newest ?? year) - year) / RECENT_YEARS) + 1) + 1;
    buckets.set(start, (buckets.get(start) ?? 0) + 1);
  }
  return {
    total: items.length,
    withYear: years.length,
    withDoi: items.filter((item) => item.doi !== null).length,
    newest,
    median: years.length ? (years[Math.floor((years.length - 1) / 2)] ?? null) : null,
    recent,
    buckets: [...buckets]
      .sort(([a], [b]) => b - a)
      .map(([start, count]) => ({ from: start, to: start + RECENT_YEARS - 1, count })),
  };
}

/** The paper's own DOI, if its first page states one. References are excluded. */
export function paperDoi(paper: Paper) {
  const references = new Set(paperReferenceParagraphs(paper));
  for (const paragraph of paper.paragraphs) {
    if (references.has(paragraph) || (paragraph.pageStart ?? 1) > 1) continue;
    const doi = doiIn(paragraph.text);
    if (doi) return doi;
  }
  return null;
}

/** A comma or a bar would be read as a separator in the OpenAlex filter, so those DOIs cannot be sent. */
export function doisToCheck(paper: Paper, items: ReferenceItem[]) {
  const own = paperDoi(paper);
  return [
    ...new Set([...(own ? [own] : []), ...items.flatMap((item) => (item.doi ? [item.doi] : []))]),
  ].filter((doi) => !/[,|]/u.test(doi));
}

export interface WorkStatus {
  doi: string;
  title: string | null;
  year: number | null;
  isRetracted: boolean;
}

/** Reads one page of the OpenAlex works list. Records without a usable DOI are skipped. */
export function mapWorkStatuses(body: unknown): WorkStatus[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw: Record<string, unknown>) => {
    const doi = typeof raw.doi === 'string' ? normalizeDoi(raw.doi) : null;
    if (!doi) return [];
    return [
      {
        doi,
        title: typeof raw.title === 'string' ? raw.title : null,
        year: typeof raw.publication_year === 'number' ? raw.publication_year : null,
        isRetracted: raw.is_retracted === true,
      },
    ];
  });
}

export function retractedWorks(statuses: WorkStatus[], own: string | null): RetractedWork[] {
  return statuses
    .filter((status) => status.isRetracted)
    .map(({ doi, title, year }) => ({ doi, title, year, isPaper: doi === own }));
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One OpenAlex work as the metadata panel shows it. Anything missing stays null rather than guessed. */
export function mapPaperMetadata(raw: unknown, fetchedAt: string): PaperMetadata | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const work = raw as Record<string, unknown>;
  const biblio = (work.biblio ?? {}) as Record<string, unknown>;
  const location = (work.primary_location ?? {}) as Record<string, unknown>;
  const source = (location.source ?? {}) as Record<string, unknown>;
  const topic = (work.primary_topic ?? {}) as Record<string, unknown>;
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  const first = text(biblio.first_page);
  const last = text(biblio.last_page);
  return {
    source: 'openalex',
    fetchedAt,
    doi: typeof work.doi === 'string' ? normalizeDoi(work.doi) : null,
    title: text(work.display_name) ?? text(work.title),
    type: text(work.type),
    year: typeof work.publication_year === 'number' ? work.publication_year : null,
    authors: authorships.flatMap((entry: Record<string, unknown>) => {
      const name = text((entry.author as Record<string, unknown> | undefined)?.display_name);
      return name ? [name] : [];
    }),
    venue: text(source.display_name),
    volume: text(biblio.volume),
    issue: text(biblio.issue),
    pages: first && last && first !== last ? `${first}–${last}` : first,
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
    topic: text(topic.display_name),
  };
}

/** What the DOI library already knows, so the panel works without a lookup. */
export function metadataFromLibrary(item: LibraryItem, fetchedAt: string): PaperMetadata {
  return {
    source: 'library',
    fetchedAt,
    doi: item.doi,
    title: item.title,
    type: null,
    year: item.year,
    authors: item.authors,
    venue: item.venue,
    volume: null,
    issue: null,
    pages: null,
    citedBy: null,
    topic: item.taxonomy?.topic ?? null,
  };
}

/** An arXiv file name such as 2605.03202v2.pdf gives the DataCite DOI arXiv registers for it. */
export function arxivDoiFromFileName(fileName: string) {
  const id = /^(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/iu.exec(fileName.trim())?.[1];
  return id ? `10.48550/arxiv.${id}` : null;
}

/** OpenAlex stores an abstract as word positions; this puts the words back in order. */
export function abstractFromIndex(index: unknown): string | null {
  if (typeof index !== 'object' || index === null) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (Number.isInteger(position) && position >= 0) words[position] = word;
  }
  const text = words
    .filter((word) => word !== undefined)
    .join(' ')
    .trim();
  return text || null;
}
