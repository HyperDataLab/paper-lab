import type { Paper } from '@/core/schemas';

/** A place a reader recognises: the page and section, never an internal id. */
export function placeLabel(paper: Paper, paragraphId: string) {
  const paragraph = paper.paragraphs.find((item) => item.id === paragraphId);
  if (!paragraph) return 'Không rõ vị trí';
  const heading = paper.sections.find((section) => section.id === paragraph.sectionId)?.heading;
  return [paragraph.pageStart ? `Tr. ${paragraph.pageStart}` : null, heading].filter(Boolean).join(' · ');
}
