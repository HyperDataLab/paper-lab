import { buildAnalysisReport } from '@/core/report';
import type { Repositories } from '@/shared/storage/repositories';

export async function loadReport(repo: Repositories, id: string) {
  const analysis = await repo.analyses.get(id);
  if (!analysis) throw new Error('Analysis not found');
  const [audit, revisions, parent, generation, originRevision] = await Promise.all([
    repo.audit.listByAnalysis(id),
    repo.revisions.listBySource(id),
    analysis.parentAnalysisId ? repo.analyses.get(analysis.parentAnalysisId) : null,
    analysis.origin?.kind === 'generated' ? repo.generations.get(analysis.origin.generationId) : null,
    analysis.origin?.kind === 'revision' ? repo.revisions.get(analysis.origin.revisionId) : null,
  ]);
  return buildAnalysisReport(analysis, {
    audit: audit.items,
    revisions: originRevision ? [...revisions, originRevision] : revisions,
    parent: parent ?? null,
    generation: generation ?? null,
  });
}
