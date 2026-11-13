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

type Citation = GrobidResult['citations'][number];
type Reference = GrobidResult['references'][number];
type Marker = { author: string; year: number; suffix: string };

function markerOf(text: string): Marker | null {
  const match = text.match(
    /^\s*[([{;]*\s*([\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*)(?:\s+(?:et\s+al\.?|(?:and|&)\s+[\p{L}\p{M}'’-]+))?\s*,?\s*\(?\s*((?:19|20)\d{2})([a-z])?\s*[\s,;\])}]*$/iu,
  );
  if (!match?.[1] || !match[2]) return null;
  return {
    author: normalize(match[1]),
    year: Number(match[2]),
    suffix: match[3]?.toLowerCase() ?? '',
  };
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(normalize(text));
}

/** Pair only unclaimed references; repeated occurrences of the same marker share one claim. */
export function pairLeftoverCitations(citations: Citation[], references: Reference[]): Map<number, string> {
  const groups = new Map<string, { marker: Marker; indexes: number[]; candidates: Reference[] }>();
  citations.forEach((citation, index) => {
    const marker = markerOf(citation.text);
    if (!marker) return;
    const key = `${marker.author}|${marker.year}|${marker.suffix}`;
    const existing = groups.get(key);
    if (existing) {
      existing.indexes.push(index);
      return;
    }
    const matching = references.filter((reference) => {
      if (reference.year !== null && reference.year !== marker.year) return false;
      return (
        reference.authors.some((author) => containsWord(author.surname, marker.author)) ||
        [reference.title, reference.venue, reference.rawText, reference.referenceText].some((text) =>
          containsWord(text ?? '', marker.author),
        )
      );
    });
    const exact = matching.filter((reference) => reference.year === marker.year);
    groups.set(key, { marker, indexes: [index], candidates: exact.length ? exact : matching });
  });
  const all = [...groups.values()];
  const paired = new Map<number, string>();
  const assign = (group: (typeof all)[number], reference: Reference) => {
    group.indexes.forEach((index) => paired.set(index, reference.id));
  };
  for (const group of all) {
    const reference = group.candidates[0];
    if (
      group.candidates.length === 1 &&
      reference &&
      all.filter((other) => other.candidates.includes(reference)).length === 1
    )
      assign(group, reference);
  }
  const suffixGroups = new Map<string, typeof all>();
  for (const group of all) {
    if (!group.marker.suffix || paired.has(group.indexes[0] ?? -1)) continue;
    const key = `${group.marker.author}|${group.marker.year}`;
    suffixGroups.set(key, [...(suffixGroups.get(key) ?? []), group]);
  }
  for (const siblings of suffixGroups.values()) {
    const candidates = references.filter((reference) =>
      siblings.some((group) => group.candidates.includes(reference)),
    );
    if (
      siblings.length < 2 ||
      candidates.length !== siblings.length ||
      siblings.some((group) => group.candidates.length !== candidates.length) ||
      all.some(
        (group) => !siblings.includes(group) && group.candidates.some((ref) => candidates.includes(ref)),
      )
    )
      continue;
    siblings.sort((a, b) => a.marker.suffix.localeCompare(b.marker.suffix));
    siblings.forEach((group, index) => {
      const reference = candidates[index];
      if (reference) assign(group, reference);
    });
  }
  // A surname cut at a line-break hyphen ("Shcher-") still names its reference when exactly one unclaimed
  // reference has an author whose surname starts with the cut part.
  const claimed = new Set(paired.values());
  citations.forEach((citation, index) => {
    if (paired.has(index) || !isCutCitation(citation.text)) return;
    const stem = normalize(citation.text.replace(/^[\s([{;]+/u, '').replace(/-\s*$/u, ''));
    if (stem.length < 4 || /\s/u.test(stem)) return;
    const candidates = references.filter(
      (reference) =>
        !claimed.has(reference.id) &&
        reference.authors.some((author) => normalize(author.surname).startsWith(stem)),
    );
    if (candidates.length === 1 && candidates[0]) paired.set(index, candidates[0].id);
  });
  return paired;
}
