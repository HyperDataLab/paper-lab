import { parseDoiInput, normalizeDoi } from '@/core/library';
import type { LibraryItem, Paper, PaperContextRecord, PaperSummary } from '@/core/schemas';

export interface LocalPaperMatch {
  paperId: string | null;
  title: string;
  doi: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
}

const normalizedText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Search only this ResearchHub project's PaperLab workspace after a Lab KG query has no rows. */
export function findLocalPaperMatches(
  question: string,
  papers: Pick<PaperSummary, 'id' | 'title' | 'detectedTitle'>[],
  contexts: PaperContextRecord[],
  library: LibraryItem[],
): LocalPaperMatch[] {
  const requestedDois = new Set(parseDoiInput(question).dois);
  const normalizedQuestion = normalizedText(question);
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const contextById = new Map(contexts.map((context) => [context.paperId, context]));
  const libraryByPaperId = new Map(
    library.flatMap((item) => (item.paper_id ? [[item.paper_id, item] as const] : [])),
  );
  const candidates = new Map<string, LocalPaperMatch>();

  for (const paper of papers) {
    const context = contextById.get(paper.id);
    const item = libraryByPaperId.get(paper.id);
    const metadata = context?.metadata;
    const doi = normalizeDoi(metadata?.doi ?? context?.paperDoi ?? item?.doi ?? '');
    const title = metadata?.title ?? item?.title ?? paper.detectedTitle ?? paper.title;
    const normalizedTitle = normalizedText(title);
    const doiMatch = Boolean(doi && requestedDois.has(doi));
    const titleMatch = normalizedTitle.length >= 16 && normalizedQuestion.includes(normalizedTitle);
    if (!doiMatch && !titleMatch) continue;

    candidates.set(paper.id, {
      paperId: paper.id,
      title,
      doi,
      authors: metadata?.authors ?? item?.authors ?? [],
      year: metadata?.year ?? item?.year ?? null,
      venue: metadata?.venue ?? item?.venue ?? null,
      abstract: null,
    });
  }

  for (const item of library) {
    if (item.paper_id && paperById.has(item.paper_id)) continue;
    const doi = normalizeDoi(item.doi);
    const title = item.title ?? '';
    const normalizedTitle = normalizedText(title);
    const doiMatch = Boolean(doi && requestedDois.has(doi));
    const titleMatch = normalizedTitle.length >= 16 && normalizedQuestion.includes(normalizedTitle);
    if (!doiMatch && !titleMatch) continue;
    candidates.set(`library:${item.id}`, {
      paperId: null,
      title: title || item.doi,
      doi,
      authors: item.authors,
      year: item.year,
      venue: item.venue,
      abstract: null,
    });
  }

  return [...candidates.values()].slice(0, 10);
}

export function addLocalPaperAbstracts(matches: LocalPaperMatch[], papers: (Paper | undefined)[]) {
  const abstracts = new Map(
    papers.flatMap((paper) => {
      if (!paper) return [];
      const sectionIds = new Set(
        paper.sections.filter((section) => section.role === 'abstract').map((section) => section.id),
      );
      const text = paper.paragraphs
        .filter((paragraph) => sectionIds.has(paragraph.sectionId))
        .map((paragraph) => paragraph.text)
        .join('\n\n');
      return text ? [[paper.id, text] as const] : [];
    }),
  );
  return matches.map((match) => ({
    ...match,
    abstract: match.paperId ? (abstracts.get(match.paperId) ?? null) : null,
  }));
}
