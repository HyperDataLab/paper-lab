import type { GrobidResult } from '../schemas';

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

/** Resolve only an unambiguous author–year marker, using reference-list order for suffixes. */
export function resolveCitation(citation: string, references: GrobidResult['references']): string | null {
  const match = citation.match(
    /^\s*[([{;]*\s*([\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*)(?:\s+(?:et\s+al\.?|(?:and|&)\s+[\p{L}\p{M}'’-]+))?\s*,?\s*((?:19|20)\d{2})([a-z])?\s*[\s,;\])}]*$/iu,
  );
  if (!match || !match[1] || !match[2]) return null;
  const author = normalize(match[1]);
  const candidates = references.filter(
    (reference) =>
      reference.year === Number(match[2]) &&
      normalize(reference.authors[0]?.surname || reference.authors[0]?.forename || '') === author,
  );
  const suffix = match[3]?.toLowerCase();
  return suffix
    ? (candidates[suffix.charCodeAt(0) - 97]?.id ?? null)
    : candidates.length === 1
      ? (candidates[0]?.id ?? null)
      : null;
}

/** A marker cut in the middle of a hyphenated word cannot support a missing-reference finding. */
export const isCutCitation = (text: string) => /[\p{L}\p{M}]-\s*$/u.test(text);
