import type { Paper } from '@/core/schemas';

export function uniquePageSources<T extends { paragraphId: string; page: number | null }>(
  sources: T[],
  paper: Paper,
): T[] {
  const seen = new Set<number>();
  return sources.filter((source) => {
    if (!paper.paragraphs.some((paragraph) => paragraph.id === source.paragraphId)) return false;
    if (source.page === null) return true;
    if (seen.has(source.page)) return false;
    seen.add(source.page);
    return true;
  });
}
