import type { FindingLocation } from '@/core/paperFindings';
import type { Paper } from '@/core/schemas';

const LIMIT = 200;

/**
 * Every place a phrase appears in the paper's body text, in reading order, as code-point offsets of its
 * paragraph. Case and accents of the query are matched as typed, ignoring letter case only.
 */
export function findInPaper(paper: Paper, query: string): FindingLocation[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const hits: FindingLocation[] = [];
  for (const paragraph of paper.paragraphs) {
    if (paragraph.kind !== 'body') continue;
    const text = paragraph.text.toLocaleLowerCase();
    let at = text.indexOf(needle);
    while (at >= 0 && hits.length < LIMIT) {
      const start = Array.from(paragraph.text.slice(0, at)).length;
      const end = start + Array.from(paragraph.text.slice(at, at + needle.length)).length;
      hits.push({ paragraphId: paragraph.id, start, end });
      at = text.indexOf(needle, at + needle.length);
    }
    if (hits.length >= LIMIT) break;
  }
  return hits;
}
