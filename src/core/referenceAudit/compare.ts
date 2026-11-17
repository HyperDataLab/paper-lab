import { z } from 'zod';
import { AuditRecordSchema, type AuditItem } from './schema';

const candidateSchema = AuditRecordSchema.extend({
  doi: z.string().optional(),
  authors: z.array(z.string()),
  match_score: z.number().optional(),
});
const outputSchema = z.object({
  lookup: z.enum(['doi', 'bibliographic']),
  status: z.string(),
  candidates: z.array(candidateSchema),
});
const stop = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'by', 'from']);
const words = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const significant = (s: string) => words(s).filter((w) => !stop.has(w));
// These overlap thresholds are rules of thumb, not probabilities or proof of identity.
function overlap(value: string, text: string, threshold: number) {
  const tokens = significant(value);
  const present = new Set(words(text));
  return (
    tokens.length > 0 && tokens.filter((token) => present.has(token)).length / tokens.length >= threshold
  );
}
function hasToken(text: string, token: string) {
  return words(text).includes(words(token).join(''));
}

export function compareReference(
  text: string,
  statedYear: number | null,
  output: unknown,
): Omit<AuditItem, 'index' | 'textHash'> {
  const parsed = outputSchema.parse(output);
  const notes = parsed.lookup === 'bibliographic' ? ['no_doi_in_text'] : [];
  const base = { lookup: parsed.lookup, mismatches: [] as AuditItem['mismatches'], notes };
  if (parsed.lookup === 'doi' && parsed.status === 'not_registered_with_crossref')
    return { ...base, verdict: 'not_registered' };
  const candidate = parsed.candidates[0];
  if (!candidate?.doi) return { ...base, verdict: 'unresolved', notes: [...notes, 'no_title_match'] };
  const titleMatches = candidate.title ? overlap(candidate.title, text, 0.8) : false;
  if (parsed.lookup === 'bibliographic' && !titleMatches)
    return { ...base, verdict: 'unresolved', notes: [...notes, 'no_title_match'] };
  const record = AuditRecordSchema.parse({ ...candidate, authors: candidate.authors.slice(0, 5) });
  const mismatches = base.mismatches;
  if (record.title && !titleMatches) mismatches.push({ field: 'title', record: record.title });
  const family = record.authors[0]?.trim().split(/\s+/u).at(-1);
  if (family && !hasToken(text, family)) mismatches.push({ field: 'first_author', record: family });
  const years = [record.issued_year, record.published_online_year, record.published_print_year].filter(
    (year): year is number => year !== undefined,
  );
  if (statedYear !== null && years.length && !years.includes(statedYear)) {
    mismatches.push({ field: 'year', stated: String(statedYear), record: String(years[0]) });
    // Only a hint when the record itself has different online and print years.
    const split =
      record.published_online_year !== undefined &&
      record.published_print_year !== undefined &&
      record.published_online_year !== record.published_print_year;
    if (split && years.some((year) => Math.abs(year - statedYear) <= 1)) notes.push('online_first_year');
  }
  // Only inspect a journal when the text has a part between title and year; initials are a common abbreviation.
  const afterTitle =
    record.title && titleMatches ? text.toLowerCase().indexOf(record.title.toLowerCase()) : -1;
  const tail = afterTitle >= 0 ? text.slice(afterTitle + (record.title?.length ?? 0)) : '';
  const journalPart = tail
    .split(/\b(?:19|20)\d{2}\b/u)[0]
    ?.replace(/^[\s.,;:]+/u, '')
    .trim();
  if (record.type === 'journal-article' && record.container_title && journalPart) {
    const initials = significant(record.container_title)
      .map((w) => w[0])
      .join('');
    const abbreviation = initials.length > 1 && words(journalPart).some((w) => w === initials);
    if (!overlap(record.container_title, journalPart, 0.6) && !abbreviation)
      mismatches.push({ field: 'journal', stated: journalPart, record: record.container_title });
  }
  if (record.volume && !hasToken(text, record.volume))
    mismatches.push({ field: 'volume', record: record.volume });
  const firstPage = record.pages?.split(/[-–—]/u)[0]?.trim();
  if (firstPage && !hasToken(text, firstPage)) mismatches.push({ field: 'pages', record: record.pages });
  return { ...base, record, verdict: mismatches.length ? 'mismatch' : 'matched' };
}
