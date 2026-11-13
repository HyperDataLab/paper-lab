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
  const authorReferences = references.filter((reference) => {
    const name = normalize(reference.authors[0]?.surname || reference.authors[0]?.forename || '');
    const titleMatches = [reference.title, reference.venue].some((title) => {
      const normalized = normalize(title ?? '');
      return normalized.startsWith(author) && !/^[\p{L}\p{M}\p{N}]/u.test(normalized.slice(author.length));
    });
    return name === author || titleMatches;
  });
  const suffix = match[3]?.toLowerCase();
  const candidates = authorReferences.filter((reference) => reference.year === Number(match[2]));
  if (!suffix && authorReferences.length === 1 && authorReferences[0]?.year === null)
    return authorReferences[0].id;
  if (!suffix) return candidates.length === 1 ? (candidates[0]?.id ?? null) : null;
  const explicit = candidates.filter((reference) => reference.suffix === suffix);
  if (explicit.length) return explicit.length === 1 ? (explicit[0]?.id ?? null) : null;
  const ordered = candidates[suffix.charCodeAt(0) - 97];
  return ordered && !ordered.suffix ? ordered.id : null;
}

/** A marker cut in the middle of a hyphenated word cannot support a missing-reference finding. */
export const isCutCitation = (text: string) => /[\p{L}\p{M}]-\s*$/u.test(text);
