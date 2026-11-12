import type { Paper } from '@/core/schemas';

type Role = Paper['sections'][number]['role'];

/** The kind of section a reader names a place by; a section of another kind is named by its heading. */
export const ROLE_LABELS: Partial<Record<Role, string>> = {
  title: 'Front matter',
  abstract: 'Abstract',
  introduction: 'Introduction',
  related_work: 'Related work',
  methods: 'Methods',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  references: 'References',
  appendix: 'Appendix',
};
const SHORT = 24;

/** Where a paragraph is: the kind of its section, a short name for it, its page and the full heading. */
export function placeOf(paper: Paper, paragraphId: string) {
  const paragraph = paper.paragraphs.find((item) => item.id === paragraphId);
  if (!paragraph) return null;
  const section = paper.sections.find((item) => item.id === paragraph.sectionId);
  const role: Role = section?.role ?? 'other';
  const heading = section?.heading.trim() ?? '';
  const label =
    ROLE_LABELS[role] ??
    (heading.length > SHORT ? `${heading.slice(0, SHORT - 1).trimEnd()}…` : heading || 'Không rõ mục');
  return { role, label, page: paragraph.pageStart, heading };
}

/** A place a reader recognises: the kind of section and the page, never an internal id. */
export function placeLabel(paper: Paper, paragraphId: string) {
  const place = placeOf(paper, paragraphId);
  if (!place) return 'Không rõ vị trí';
  return [place.label, place.page ? `Tr. ${place.page}` : null].filter(Boolean).join(' · ');
}
