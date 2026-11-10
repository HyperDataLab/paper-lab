import { locate } from '../reviewPanel';
import {
  SNAPSHOT_FIELDS,
  type Paper,
  type PaperParagraph,
  type SnapshotOutput,
  type SnapshotValue,
} from '../schemas';

const INPUT_CHARS = 24000;
const ROLE_ORDER = ['abstract', 'methods', 'results', 'introduction', 'discussion', 'conclusion', 'other'];
const NUMBERS = /\d+(?:[.,]\d+)?/gu;

/** The abstract and methods come first, since they state most of the snapshot. */
export function snapshotInput(paper: Paper) {
  const rank = (paragraph: PaperParagraph) => {
    const role = paper.sections.find((section) => section.id === paragraph.sectionId)?.role ?? 'other';
    const index = ROLE_ORDER.indexOf(role);
    return index < 0 ? ROLE_ORDER.length : index;
  };
  const ordered = paper.paragraphs
    .filter((paragraph) => paragraph.kind === 'body' && rank(paragraph) < ROLE_ORDER.length)
    .map((paragraph, index) => ({ paragraph, index }))
    .sort((a, b) => rank(a.paragraph) - rank(b.paragraph) || a.index - b.index);
  const chosen: PaperParagraph[] = [];
  let size = 0;
  for (const { paragraph } of ordered) {
    if (size + paragraph.text.length > INPUT_CHARS) continue;
    chosen.push(paragraph);
    size += paragraph.text.length;
  }
  return chosen;
}

/**
 * A value is shown only with a quote code can find. A number in the value must also appear in the quote, so a
 * converted or invented sample size is withheld.
 */
export function verifySnapshot(output: SnapshotOutput, paragraphs: PaperParagraph[]): SnapshotValue[] {
  return SNAPSHOT_FIELDS.map((field) => {
    const raw = output.fields.find((item) => item.field === field);
    const id = `snap-${field}`;
    if (!raw?.value) return { id, field, status: 'not_reported', value: null, source: null };
    const paragraph = paragraphs.find((p) => p.id === raw.paragraphId);
    const found = paragraph && raw.quote ? locate(paragraph.text, raw.quote) : null;
    if (!paragraph || !found) return { id, field, status: 'unverified', value: null, source: null };
    const excerpt = Array.from(paragraph.text).slice(found.start, found.end).join('');
    const numbers = raw.value.match(NUMBERS) ?? [];
    if (numbers.some((number) => !excerpt.includes(number)))
      return { id, field, status: 'unverified', value: null, source: null };
    return {
      id,
      field,
      status: 'reported',
      value: raw.value,
      source: {
        paragraphId: paragraph.id,
        sectionId: paragraph.sectionId,
        page: paragraph.pageStart,
        start: found.start,
        end: found.end,
        excerpt,
      },
    };
  });
}
