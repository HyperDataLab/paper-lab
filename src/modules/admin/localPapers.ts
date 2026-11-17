import { publishedIdFor } from '@/core/paperModel/published';
import type { Paper } from '@/core/schemas';

/** The papers kept in this browser, by the id they are (or would be) published under. */
export function papersByPublishedId(papers: Paper[]) {
  const index = new Map<string, Paper>();
  for (const paper of papers) {
    try {
      index.set(publishedIdFor(paper.source.sha256, paper.id), paper);
    } catch {
      // A hash that is not SHA-256 hex cannot have been published, so it matches no request.
    }
  }
  return index;
}
