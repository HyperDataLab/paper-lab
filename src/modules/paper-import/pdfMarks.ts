import type { Criterion, FindingLocation, PaperMark } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';

/** A stretch of one text item of a PDF page: `item` indexes the page's text items, `to` is exclusive. */
export interface ItemRange {
  item: number;
  from: number;
  to: number;
}

/** What to look for on a page: the passage, with a little of the paragraph around it to tell repeats apart. */
export interface PdfNeedle {
  id: string;
  /** The page the paragraph starts on; it may run onto the next page. */
  page: number;
  before: string;
  text: string;
  after: string;
}

/** A mark drawn on the PDF. */
export interface PdfMark extends PdfNeedle {
  criterion: Criterion;
  title: string;
  /** A finding (something to review), drawn stronger than an analysis mark. */
  strong: boolean;
}

const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
};
const SAME: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '″': '"',
};

/**
 * What a character counts as when PDF text and parsed text are compared. Spaces, line breaks and every kind
 * of hyphen or dash are left out: PDFs break lines and words in places the parsed text does not, and a
 * hyphen at a line end cannot be told from one inside a word.
 */
function normalChar(char: string): string {
  if (/\s/.test(char)) return '';
  if (/[­‐-―−-]/.test(char)) return '';
  return LIGATURES[char] ?? SAME[char] ?? char;
}

export function normalise(text: string): string {
  let out = '';
  for (const char of text) out += normalChar(char);
  return out;
}

/** The page's text with, for each compared character, the item and offset it came from. */
function index(items: string[]) {
  let text = '';
  const origin: { item: number; offset: number }[] = [];
  items.forEach((item, itemIndex) => {
    let offset = 0;
    for (const char of item) {
      for (const part of normalChar(char)) {
        text += part;
        origin.push({ item: itemIndex, offset });
      }
      offset += char.length;
    }
  });
  return { text, origin };
}

function toRanges(
  origin: { item: number; offset: number }[],
  start: number,
  end: number,
  items: string[],
): ItemRange[] {
  const ranges: ItemRange[] = [];
  for (let at = start; at < end; at += 1) {
    const where = origin[at];
    if (!where) continue;
    const char = items[where.item]?.codePointAt(where.offset) ?? 0;
    const to = where.offset + (char > 0xffff ? 2 : 1);
    const last = ranges.at(-1);
    // Within one item the match is unbroken: skipped spaces and hyphens between its characters belong to it.
    if (last && last.item === where.item) last.to = Math.max(last.to, to);
    else ranges.push({ item: where.item, from: where.offset, to });
  }
  return ranges;
}

/** Below this many compared characters a passage is too common to look for without its context. */
const SHORT = 12;
/** A passage longer than this is found by its first and last words. */
const LONG = 400;
const ENDS = 60;

/**
 * Where a passage lies in a PDF page's text items, or null. Only the whole passage counts: it is looked for
 * with the paragraph text around it first, so a phrase that repeats on the page is found in the right place.
 */
export function findNeedle(
  items: string[],
  needle: Pick<PdfNeedle, 'before' | 'text' | 'after'>,
): ItemRange[] | null {
  const page = index(items);
  const before = normalise(needle.before);
  const text = normalise(needle.text);
  const after = normalise(needle.after);
  if (!text) return null;
  const tries: [string, string][] = [
    [before, after],
    ['', after],
    [before, ''],
  ];
  if (text.length >= SHORT) tries.push(['', '']);
  if (text.length > LONG) {
    const head = text.slice(0, ENDS);
    const tail = text.slice(-ENDS);
    const start = page.text.indexOf(head);
    if (start < 0) return null;
    const tailAt = page.text.indexOf(tail, start + text.length - ENDS * 2);
    if (tailAt < 0 || tailAt + ENDS - start > text.length * 1.5) return null;
    return toRanges(page.origin, start, tailAt + ENDS, items);
  }
  for (const [lead, trail] of tries) {
    if (!lead && !trail && text.length < SHORT) continue;
    const at = page.text.indexOf(lead + text + trail);
    if (at < 0) continue;
    const start = at + lead.length;
    return toRanges(page.origin, start, start + text.length, items);
  }
  return null;
}

const CONTEXT = 40;

/** The PDF marks for a paper's marks: each passage with its paragraph's page and some text around it. */
export function pdfMarks(paper: Paper, marks: PaperMark[], titleOf: (mark: PaperMark) => string): PdfMark[] {
  const paragraphs = new Map(paper.paragraphs.map((item) => [item.id, item]));
  return marks.flatMap((mark) => {
    const needle = pdfNeedle(paper, mark, mark.id, paragraphs);
    return needle
      ? [{ ...needle, criterion: mark.criterion, title: titleOf(mark), strong: mark.findingId !== null }]
      : [];
  });
}

/** The needle for one passage of the paper, or null when its paragraph has no page. */
export function pdfNeedle(
  paper: Paper,
  location: FindingLocation,
  id: string,
  paragraphs = new Map(paper.paragraphs.map((item) => [item.id, item])),
): PdfNeedle | null {
  const paragraph = paragraphs.get(location.paragraphId);
  if (!paragraph?.pageStart || location.end <= location.start) return null;
  const text = paragraph.text;
  return {
    id,
    page: paragraph.pageStart,
    before: text.slice(Math.max(0, location.start - CONTEXT), location.start),
    text: text.slice(location.start, location.end),
    after: text.slice(location.end, location.end + CONTEXT),
  };
}
