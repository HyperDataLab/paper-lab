import { normalizeDoi } from '@/core/library/doi';
import type { ShownMetadata } from '@/core/grobid/merge';
import type { PaperMetadata } from '@/core/schemas';

export interface MetadataDraft {
  title: string;
  authors: string;
  year: string;
  venue: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  keywords: string;
}

export const SOURCE_LABELS: Record<ShownMetadata['source'], string> = {
  manual: 'Nhập tay',
  openalex: 'OpenAlex',
  library: 'Thư viện DOI',
  grobid: 'GROBID (đọc từ PDF)',
};

export function draftFrom(metadata: ShownMetadata | null, title: string, doi: string): MetadataDraft {
  return {
    title: metadata?.title ?? title,
    authors: (metadata?.authors ?? []).join('\n'),
    year: metadata?.year === null || metadata?.year === undefined ? '' : String(metadata.year),
    venue: metadata?.venue ?? '',
    volume: metadata?.volume ?? '',
    issue: metadata?.issue ?? '',
    pages: metadata?.pages ?? '',
    doi: metadata?.doi ?? doi,
    keywords: (metadata?.keywords ?? []).join(', '),
  };
}

const orNull = (value: string) => value.trim() || null;

/**
 * The reader's edits over what was known before, so fields the form does not show (citations,
 * topic, type, affiliations) survive a manual save.
 */
export function metadataFromDraft(
  draft: MetadataDraft,
  base: ShownMetadata | null,
  fetchedAt: string,
): { metadata: PaperMetadata } | { error: string } {
  const year = draft.year.trim();
  if (year && !/^\d{1,4}$/u.test(year)) return { error: 'Năm phải là số nguyên, hoặc để trống.' };
  const doiText = draft.doi.trim();
  const doi = doiText ? normalizeDoi(doiText) : null;
  if (doiText && !doi) return { error: 'DOI chưa hợp lệ.' };
  return {
    metadata: {
      source: 'manual',
      fetchedAt,
      doi,
      title: orNull(draft.title),
      type: base?.type ?? null,
      year: year ? Number(year) : null,
      authors: draft.authors
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean),
      affiliations: base?.affiliations ?? [],
      keywords: draft.keywords
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean),
      venue: orNull(draft.venue),
      volume: orNull(draft.volume),
      issue: orNull(draft.issue),
      pages: orNull(draft.pages),
      citedBy: base?.citedBy ?? null,
      topic: base?.topic ?? null,
    },
  };
}

/** `<title slug>-paper-model.json`; diacritics are dropped so the name is safe on every file system. */
export function paperModelFileName(title: string | null): string {
  const slug = (title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/giu, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replace(/-+$/u, '');
  return `${slug || 'paper'}-paper-model.json`;
}
