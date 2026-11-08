import type { AnchoredReview } from './index';
import { sourceHash } from '../text/hash';

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'is',
  'it',
  'this',
  'that',
  'và',
  'của',
  'là',
  'các',
  'một',
  'trong',
]);
const words = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w));
export function panelSimilarity(reviews: AnchoredReview[]) {
  const docs = reviews.map((r) =>
    words(
      r.points
        .filter((p) => p.kind === 'weakness' || p.kind === 'question')
        .map((p) => `${p.point} ${p.rationale}`)
        .join(' '),
    ),
  );
  const vectors = docs.map((doc) => {
    const result = new Map<string, number>();
    for (const word of doc) result.set(word, (result.get(word) ?? 0) + 1);
    for (const [word, count] of result)
      result.set(
        word,
        count * (Math.log((1 + docs.length) / (1 + docs.filter((d) => d.includes(word)).length)) + 1),
      );
    return result;
  });
  const matrix = vectors.map((a) =>
    vectors.map((b) => {
      const dot = [...a].reduce((sum, [word, value]) => sum + value * (b.get(word) ?? 0), 0);
      const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((sum, n) => sum + n * n, 0));
      const denominator = norm(a) * norm(b);
      return denominator ? dot / denominator : 0;
    }),
  );
  const pairs: { lenses: [string, string]; similarity: number }[] = [];
  for (let i = 0; i < reviews.length; i++)
    for (let j = i + 1; j < reviews.length; j++) {
      const a = reviews[i],
        b = reviews[j];
      if (a && b) pairs.push({ lenses: [a.lens, b.lens], similarity: matrix[i]?.[j] ?? 0 });
    }
  return {
    matrix,
    mean: pairs.length ? pairs.reduce((n, p) => n + p.similarity, 0) / pairs.length : null,
    similarPairs: pairs.filter((p) => p.similarity > 0.8),
  };
}
export type ReviewNgram = { hash: string; paperId: string };
export async function templatePhrases(reviews: AnchoredReview[], paperId: string, previous: ReviewNgram[]) {
  const phrases = new Set<string>();
  for (const review of reviews)
    for (const point of review.points)
      for (const text of [point.point, point.rationale, point.quote]) {
        const parts = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
        for (let length = 6; length <= 12; length++)
          for (let i = 0; i + length <= parts.length; i++) phrases.add(parts.slice(i, i + length).join(' '));
      }
  const entries = await Promise.all(
    [...phrases].map(async (phrase) => ({ phrase, hash: await sourceHash(phrase) })),
  );
  return {
    flags: entries.filter(
      ({ hash }) =>
        new Set(previous.filter((p) => p.hash === hash && p.paperId !== paperId).map((p) => p.paperId))
          .size >= 3,
    ),
    ngrams: entries.map(({ hash }) => ({ hash, paperId })),
  };
}
