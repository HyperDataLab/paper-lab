import type { Paper, PaperParagraph } from '../../../src/core/schemas/paper';

/** Paragraphs shorter than this are headings, labels or fragments, not passages worth citing. */
export const MIN_PASSAGE_CHARS = 60;
/** Stored text is capped; the embedding reads only the start (the model's input is 512 tokens). */
export const MAX_PASSAGE_CHARS = 8000;
export const EMBED_CHARS = 2000;
/** A paper's passages beyond this are left out, to keep one cron job bounded. */
export const MAX_PASSAGES_PER_PAPER = 400;

const SKIPPED_KINDS = new Set<PaperParagraph['kind']>([
  'reference',
  'heading_like',
  'footnote',
  'equation',
  'table',
]);
const SKIPPED_ROLES = new Set(['references']);

export interface SplitPassage {
  paragraphId: string;
  sectionRole: string;
  ord: number;
  text: string;
}

/** The paragraphs of a paper that the passage index keeps, in reading order. */
export function splitPassages(paper: Paper): SplitPassage[] {
  const roles = new Map(paper.sections.map((section) => [section.id, section.role]));
  const seen = new Set<string>();
  const passages: SplitPassage[] = [];
  for (const paragraph of [...paper.paragraphs].sort((a, b) => a.order - b.order)) {
    const role = roles.get(paragraph.sectionId) ?? 'other';
    if (SKIPPED_KINDS.has(paragraph.kind) || SKIPPED_ROLES.has(role) || seen.has(paragraph.id)) continue;
    const text = paragraph.text.replace(/\s+/gu, ' ').trim();
    if (text.length < MIN_PASSAGE_CHARS) continue;
    seen.add(paragraph.id);
    passages.push({
      paragraphId: paragraph.id,
      sectionRole: role,
      ord: paragraph.order,
      text: text.slice(0, MAX_PASSAGE_CHARS),
    });
    if (passages.length >= MAX_PASSAGES_PER_PAPER) break;
  }
  return passages;
}
