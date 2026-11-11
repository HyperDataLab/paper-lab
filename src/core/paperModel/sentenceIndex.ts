import type { Paper, PaperModelSentence, PaperParagraph } from '../schemas';
import { segmentSentences, sliceCp } from '../text';
import { createKeyer } from './sentenceKey';

const NEVER_INDEXED = new Set<PaperParagraph['kind']>(['reference', 'table', 'equation', 'heading_like']);
const INDEXED = new Set<PaperParagraph['kind']>(['body', 'caption']);

/** Body and caption prose, plus whatever the abstract holds; never references, tables or equations. */
export function isIndexed(paragraph: PaperParagraph, role: string | undefined): boolean {
  if (role === 'references' || NEVER_INDEXED.has(paragraph.kind)) return false;
  return role === 'abstract' || INDEXED.has(paragraph.kind);
}

/** Every indexed sentence in reading order (the order of `paper.paragraphs`). */
export function sentenceIndex(paper: Paper): PaperModelSentence[] {
  const roles = new Map(paper.sections.map((section) => [section.id, section.role]));
  const keyOf = createKeyer();
  return paper.paragraphs.flatMap((paragraph) => {
    if (!isIndexed(paragraph, roles.get(paragraph.sectionId))) return [];
    return segmentSentences(paragraph.text).map((sentence, index) => {
      const text = sliceCp(paragraph.text, sentence.start, sentence.end);
      return {
        key: keyOf(text),
        displayId: `${paragraph.id}_s${index + 1}`,
        paragraphId: paragraph.id,
        sectionId: paragraph.sectionId,
        page: paragraph.pageStart,
        start: sentence.start,
        end: sentence.end,
        text,
      };
    });
  });
}
