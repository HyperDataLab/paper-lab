import type { Paper } from '../schemas/paper';
import type { Lens, PaperReviewOutput, ReviewPoint } from '../prompts/paperReview';
export * from './metrics';

export type AnchoredPoint = ReviewPoint & {
  lens: Lens;
  anchor: { paragraphId: string; start: number; end: number };
};
export type AnchoredReview = Omit<PaperReviewOutput, 'points'> & { points: AnchoredPoint[] };

function normalized(text: string, insensitive: boolean) {
  const chars: string[] = [];
  const positions: number[] = [];
  Array.from(text).forEach((char, i) => {
    let value = /\s/u.test(char) ? ' ' : char.replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'");
    if (insensitive) value = value.toLowerCase();
    if (value === ' ' && chars.at(-1) === ' ') return;
    for (const part of value) {
      chars.push(part);
      positions.push(i);
    }
  });
  return { text: chars.join(''), positions };
}
function locate(text: string, quote: string) {
  if (!quote) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0)
    return {
      start: Array.from(text.slice(0, exact)).length,
      end: Array.from(text.slice(0, exact + quote.length)).length,
    };
  for (const insensitive of [false, true]) {
    const source = normalized(text, insensitive);
    const target = normalized(quote, insensitive).text;
    const index = source.text.indexOf(target);
    const offset = index < 0 ? -1 : Array.from(source.text.slice(0, index)).length;
    const start = source.positions[offset];
    const end = source.positions[offset + Array.from(target).length - 1];
    if (index >= 0 && start !== undefined && end !== undefined) return { start, end: end + 1 };
  }
  return null;
}
export function anchorReview(output: PaperReviewOutput, paper: Paper, sectionIds: string[]): AnchoredReview {
  const points: AnchoredPoint[] = [];
  const unanchored = [...output.unanchored];
  for (const point of output.points) {
    const paragraph = paper.paragraphs.find(
      (p) => p.id === point.paragraphId && p.kind === 'body' && sectionIds.includes(p.sectionId),
    );
    const span = paragraph && locate(paragraph.text, point.quote);
    if (span)
      points.push({ ...point, lens: output.lens, anchor: { paragraphId: point.paragraphId, ...span } });
    else unanchored.push({ point: point.point, reason: 'không tìm thấy trích dẫn' });
  }
  return { ...output, points, unanchored };
}
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
function overlap(a: string, b: string) {
  const x = new Set(tokens(a)),
    y = new Set(tokens(b));
  return Math.min(x.size, y.size) ? [...x].filter((t) => y.has(t)).length / Math.min(x.size, y.size) : 0;
}
export type MergedPoint = {
  id: string;
  lenses: Lens[];
  anchor: AnchoredPoint['anchor'];
  severity: ReviewPoint['severity'];
  wordings: AnchoredPoint[];
};
export function mergePanel(reviews: AnchoredReview[]): MergedPoint[] {
  const groups: AnchoredPoint[][] = [];
  const points = reviews
    .flatMap((r) => r.points)
    .sort(
      (a, b) =>
        a.anchor.paragraphId.localeCompare(b.anchor.paragraphId) ||
        a.anchor.start - b.anchor.start ||
        a.anchor.end - b.anchor.end ||
        a.lens.localeCompare(b.lens) ||
        a.point.localeCompare(b.point),
    );
  for (const point of points) {
    const matching = groups.filter((g) =>
      g.some(
        (p) =>
          p.lens !== point.lens &&
          p.anchor.paragraphId === point.anchor.paragraphId &&
          ((p.anchor.start < point.anchor.end && point.anchor.start < p.anchor.end) ||
            overlap(p.quote, point.quote) >= 0.6),
      ),
    );
    if (matching.length) {
      const combined = [point, ...matching.flat()];
      for (const group of matching) groups.splice(groups.indexOf(group), 1);
      groups.push(combined);
    } else groups.push([point]);
  }
  return groups
    .map((wordings) => {
      const sorted = [...wordings].sort(
        (a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end,
      );
      const first = sorted[0];
      if (!first) throw new Error('Empty review group');
      const lenses = [...new Set(wordings.map((p) => p.lens))].sort();
      const anchor = {
        paragraphId: first.anchor.paragraphId,
        start: Math.min(...wordings.map((p) => p.anchor.start)),
        end: Math.max(...wordings.map((p) => p.anchor.end)),
      };
      const severity =
        (['major', 'moderate', 'minor'] as const).find((s) => wordings.some((p) => p.severity === s)) ??
        'minor';
      return {
        id: JSON.stringify([lenses, anchor.paragraphId, anchor.start, anchor.end]),
        lenses,
        anchor,
        severity,
        wordings,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function anchoringRate(reviews: AnchoredReview[]) {
  const anchored = reviews.reduce((n, r) => n + r.points.length, 0);
  const total = anchored + reviews.reduce((n, r) => n + r.unanchored.length, 0);
  return { anchored, total, rate: total ? anchored / total : null };
}
export type HumanNotes = { paperId: string; text: string; writtenAt: string; revealedAt: string | null };
export function agreement(points: MergedPoint[], notes: HumanNotes | null) {
  return {
    matching: notes
      ? points.filter((p) => p.wordings.some((w) => overlap(`${w.quote} ${w.point}`, notes.text) >= 0.3))
          .length
      : 0,
    total: points.length,
  };
}
export function reviewRevealed(notes: HumanNotes | null) {
  return notes?.revealedAt != null;
}
export function visibleReviewRuns<T>(notes: HumanNotes | null, runs: T[]): T[] {
  return reviewRevealed(notes) ? runs : [];
}
