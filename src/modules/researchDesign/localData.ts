import type { ExtractionProject } from '@/core/schemas';
import { buildPaperModel } from '@/core/paperModel';
import { contentEtag } from '@/core/paperModel/published';
import { projectExperimentFacts } from '@/core/experimentFacts/project';
import type { PapersDoc, PaperModelView } from '@/core/researchDesign/papers';
import type { ExperimentFactsView } from '@/core/researchDesign/facts/experimentFacts';
import type { Repositories } from '@/shared/storage/types';

export async function loadLocalData(project: ExtractionProject, repo: Repositories) {
  const entries = await Promise.all(
    project.papers.map(async (item) => {
      const paper = item.source.kind === 'paper' ? await repo.papers.get(item.source.paperId) : undefined;
      const model = paper ? buildPaperModel({ paper, metadata: null, now: new Date() }) : null;
      const etag = model ? await contentEtag(model) : null;
      const measurement = paper ? await repo.measurements.get(paper.id) : undefined;
      const facts =
        paper && model && etag && measurement?.runs.length
          ? projectExperimentFacts({
              paperId: paper.id,
              modelEtag: etag,
              model,
              record: measurement,
              paper,
              now: new Date(),
            }).facts
          : null;
      return {
        paper: {
          id: item.key,
          title: item.title,
          authors: item.authors,
          year: item.year,
          venue: item.venue,
          doi: item.doi,
          decision: item.screening === 'uncertain' ? ('undecided' as const) : item.screening,
          reason: null,
          addedBy: 'local',
          addedAt: project.createdAt,
          model:
            paper && model && etag
              ? {
                  paperlab: { paperId: paper.id, etag },
                  sourceHash: model.document.source.sha256,
                  sentences: model.sentences.length,
                  importedBy: 'local',
                  importedAt: paper.createdAt,
                }
              : null,
        },
        facts: facts && model ? { facts, model } : null,
      };
    }),
  );
  const papers: PapersDoc = { schemaVersion: 1, papers: entries.map((entry) => entry.paper), log: [] };
  const facts: Record<string, { facts: ExperimentFactsView; model: PaperModelView }> = {};
  for (const entry of entries) if (entry.facts) facts[entry.paper.id] = entry.facts;
  return { papers, facts };
}
