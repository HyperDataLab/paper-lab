import { normalizeDoi } from '../library/doi';
import type { GrobidRecord, GrobidResult, Paper, PaperMetadata } from '../schemas';
import { anchorText } from './anchor';

/** Metadata as shown: a stored record, possibly with empty fields filled from GROBID's header. */
export type ShownMetadata = Omit<PaperMetadata, 'source'> & { source: PaperMetadata['source'] | 'grobid' };
export type GrobidField = 'title' | 'authors' | 'year' | 'doi';

/** The GROBID result to use, or null when there is none, it failed, or it came from another version. */
export const usableGrobid = (record: GrobidRecord | null | undefined): GrobidResult | null =>
  record?.status === 'ready' && record.result?.version === record.version ? record.result : null;

const yearOf = (date: string | null) => {
  const match = date?.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/u);
  return match ? Number(match[0]) : null;
};
const fileStem = (paper: Pick<Paper, 'source'>) => paper.source.fileName.replace(/\.[^.]+$/u, '');

/**
 * Fills only what is empty. A title that is just the file name counts as empty; anything the reader typed
 * or OpenAlex returned is kept as it is.
 */
export function mergeGrobidMetadata(
  base: PaperMetadata | null,
  record: GrobidRecord | null | undefined,
  paper: Pick<Paper, 'source'>,
): { metadata: ShownMetadata | null; filled: GrobidField[] } {
  const grobid = usableGrobid(record);
  if (!grobid || !record) return { metadata: base, filled: [] };
  const header = grobid.header;
  const authors = header.authors
    .map((person) => `${person.forename} ${person.surname}`.trim())
    .filter(Boolean);
  const year = yearOf(header.date);
  const doi = header.doi ? normalizeDoi(header.doi) : null;
  const titleEmpty = !base?.title?.trim() || base.title.trim() === fileStem(paper);
  const filled: GrobidField[] = [];
  if (titleEmpty && header.title) filled.push('title');
  if (!base?.authors.length && authors.length) filled.push('authors');
  if (!base?.year && year) filled.push('year');
  if (!base?.doi && doi) filled.push('doi');
  if (!filled.length) return { metadata: base, filled };
  const start: ShownMetadata = base ?? {
    source: 'grobid',
    fetchedAt: record.fetchedAt,
    doi: null,
    title: null,
    type: null,
    year: null,
    authors: [],
    affiliations: [],
    keywords: [],
    venue: null,
    volume: null,
    issue: null,
    pages: null,
    citedBy: null,
    topic: null,
  };
  return {
    metadata: {
      ...start,
      title: filled.includes('title') ? header.title : start.title,
      authors: filled.includes('authors') ? authors : start.authors,
      year: filled.includes('year') ? year : start.year,
      doi: filled.includes('doi') ? doi : start.doi,
    },
    filled,
  };
}

/** The reference list from GROBID, each entry placed in the paper's reference section when it can be. */
export function grobidReferenceItems(grobid: GrobidResult, referenceParagraphs: Paper['paragraphs']) {
  return grobid.references.map((reference) => {
    const authors = reference.authors.map((person) => person.surname || person.forename).filter(Boolean);
    const text =
      reference.rawText ??
      [authors.join(', '), reference.title, reference.venue, reference.year].filter(Boolean).join('. ');
    const arxivDoi = reference.arxivId
      ? normalizeDoi(`10.48550/arXiv.${reference.arxivId.replace(/v\d+$/iu, '')}`)
      : null;
    const place =
      (reference.title && anchorText(referenceParagraphs, reference.title)) ||
      (reference.rawText && anchorText(referenceParagraphs, reference.rawText)) ||
      null;
    return {
      id: reference.id,
      text,
      year: reference.year,
      doi: (reference.doi && normalizeDoi(reference.doi)) || arxivDoi,
      location: place ? { paragraphId: place.paragraph.id, start: place.start, end: place.end } : null,
      place,
    };
  });
}
