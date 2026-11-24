import type { ProjectEvidence } from './projectEvidence';

/** Builds a reader deep link for evidence tied to an imported paper. */
export function paperSourceHref(source: ProjectEvidence): string | undefined {
  if (!source.paperId) return undefined;

  const paperPath = `/papers/${encodeURIComponent(source.paperId)}`;
  const paragraphPrefix = `paper:${source.paperId}:`;
  if (source.kind !== 'Toàn văn' || !source.id.startsWith(paragraphPrefix)) return paperPath;

  const paragraphId = source.id.slice(paragraphPrefix.length);
  if (!paragraphId) return paperPath;

  const query = new URLSearchParams({ p: paragraphId });
  return `${paperPath}?${query.toString()}`;
}
