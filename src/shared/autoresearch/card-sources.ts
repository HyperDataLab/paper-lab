import type { StageContent } from '@/core/autoresearch/contracts';
import { usableGrobid } from '@/core/grobid/merge';
import { normalizeDoi } from '@/core/library/doi';
import { buildPaperModel } from '@/core/paperModel';
import type { ExtractionProject } from '@/core/schemas';
import { paperDoi } from '@/core/scholarlyContext';
import type { Repositories } from '@/shared/storage/types';

export type FullTextSource = {
  paperId: string;
  sections: {
    title: string;
    role: string;
    sentences: { key: string; text: string; page: number | null }[];
  }[];
};
export type LoadFullTexts = (dois: string[]) => Promise<Map<string, FullTextSource>>;
export type CardInput = { decisionId: string; title: string } & (
  { evidence_scope: 'abstract'; abstract: string } | ({ evidence_scope: 'full_text' } & FullTextSource)
);

export async function cardInputs(
  candidates: StageContent['S4']['candidates'],
  decisions: StageContent['S5']['decisions'],
  loadFullTexts: LoadFullTexts,
): Promise<CardInput[]> {
  const byId = new Map(candidates.map((paper) => [paper.id, paper]));
  const included = decisions.filter((decision) => decision.decision === 'included');
  const dois = [...new Set(included.flatMap(({ paperId }) => byId.get(paperId)?.doi ?? []))];
  const fullTexts = dois.length ? await loadFullTexts(dois) : new Map<string, FullTextSource>();
  return included.flatMap(({ id: decisionId, paperId }): CardInput[] => {
    const paper = byId.get(paperId);
    if (!paper) return [];
    const fullText = paper.doi ? fullTexts.get(paper.doi) : undefined;
    const base = { decisionId, title: paper.title };
    if (fullText) return [{ ...base, evidence_scope: 'full_text', ...fullText }];
    return paper.abstract ? [{ ...base, evidence_scope: 'abstract', abstract: paper.abstract }] : [];
  });
}

export async function loadProjectFullTexts(
  repo: Repositories,
  project: ExtractionProject,
  dois: string[],
  signal?: AbortSignal,
): Promise<Map<string, FullTextSource>> {
  const wanted = new Set(dois);
  const result = new Map<string, FullTextSource>();
  const [papers, contexts, library, corpus] = await Promise.all([
    repo.papers.list(),
    repo.paperContext.list(),
    repo.library.list(),
    project.corpusId ? repo.corpora.get(project.corpusId) : undefined,
  ]);
  const byPaper = new Map(contexts.map((row) => [row.paperId, row]));
  const attached = new Map(
    [
      ...(corpus?.members.flatMap(({ identifiers }) =>
        identifiers.paperIds.map((id) => [id, identifiers.doi] as const),
      ) ?? []),
      ...project.papers.flatMap((paper) =>
        paper.source.kind === 'paper' ? [[paper.source.paperId, paper.doi] as const] : [],
      ),
      ...library.flatMap((item) => (item.paper_id ? [[item.paper_id, item.doi] as const] : [])),
    ].filter(([, doi]) => doi),
  );
  for (const paper of papers) {
    signal?.throwIfAborted();
    if (result.size === wanted.size) break;
    const context = byPaper.get(paper.id);
    const known = normalizeDoi(
      context?.metadata?.doi ?? attached.get(paper.id) ?? context?.paperDoi ?? paperDoi(paper) ?? '',
    );
    const grobid = known ? null : usableGrobid(await repo.grobid.get(paper.id));
    const doi = known ?? normalizeDoi(grobid?.header.doi ?? '');
    if (!doi || !wanted.has(doi) || result.has(doi)) continue;
    const model = buildPaperModel({
      paper,
      metadata: context?.metadata ?? null,
      grobid,
      now: new Date(paper.updatedAt),
    });
    const bySection = new Map(
      model.document.sections.map((section) => [
        section.id,
        {
          title: section.title.trim() || section.role,
          role: section.role,
          sentences: [] as FullTextSource['sections'][number]['sentences'],
        },
      ]),
    );
    for (const { key, text, page, sectionId } of model.sentences)
      if (text.trim()) bySection.get(sectionId)?.sentences.push({ key, text, page });
    const sections = [...bySection.values()].filter((section) => section.sentences.length);
    if (sections.some(({ role }) => role !== 'abstract')) result.set(doi, { paperId: paper.id, sections });
  }
  return result;
}
