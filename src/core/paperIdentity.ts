import type { LibraryItem, Paper, PaperMetadata } from './schemas';

export interface PaperIdentity {
  title: string;
  /** Where the title came from. `detected` is a guess read from the first page; `file` is the file name. */
  titleSource: 'metadata' | 'library' | 'detected' | 'file';
  authors: string[];
  year: number | null;
  venue: string | null;
}

const MIN_TITLE = 8;
const MAX_TITLE = 300;

/**
 * The paper's own title as printed on its first page: the first line of the front matter, before the
 * abstract. A guess, so it is only used when no looked-up metadata exists, and null when nothing fits.
 */
export function detectTitle(paper: Paper): string | null {
  const titled = paper.sections.find((section) => section.role === 'title');
  const first = paper.sections[0];
  const section = titled ?? (first && first.role === 'other' ? first : undefined);
  if (!section) return null;
  const paragraph = paper.paragraphs
    .filter((item) => item.sectionId === section.id && (item.kind === 'body' || item.kind === 'heading_like'))
    .sort((a, b) => a.order - b.order)[0];
  const text = paragraph?.text.replace(/\s+/g, ' ').trim() ?? '';
  const length = Array.from(text).length;
  return length >= MIN_TITLE && length <= MAX_TITLE ? text : null;
}

/** Title, authors and year to show for a paper: looked-up metadata first, the file name last. */
export function paperIdentity(
  paper: Paper,
  known: {
    metadata?: Pick<PaperMetadata, 'title' | 'authors' | 'year' | 'venue'> | null;
    library?: LibraryItem | null;
  } = {},
): PaperIdentity {
  const { metadata, library } = known;
  const detected = detectTitle(paper);
  const [title, titleSource]: [string, PaperIdentity['titleSource']] = metadata?.title
    ? [metadata.title, 'metadata']
    : library?.title
      ? [library.title, 'library']
      : detected
        ? [detected, 'detected']
        : [paper.title, 'file'];
  return {
    title,
    titleSource,
    authors: metadata?.authors.length ? metadata.authors : (library?.authors ?? []),
    year: metadata?.year ?? library?.year ?? null,
    venue: metadata?.venue ?? library?.venue ?? null,
  };
}

/** "Nguyen, Tran et al." for a table cell. */
export function authorsShort(authors: string[], max = 3) {
  return authors.length > max
    ? `${authors.slice(0, max).join(', ')} và ${authors.length - max} người khác`
    : authors.join(', ');
}
