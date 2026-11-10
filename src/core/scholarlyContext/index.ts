import { normalizeDoi } from '../library/doi';
import { referenceEntries, paperReferenceParagraphs } from '../paperChecks/references';
import type { Located } from '../paperChecks/common';
import type { Finding, Paper, RetractedWork } from '../schemas';

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
