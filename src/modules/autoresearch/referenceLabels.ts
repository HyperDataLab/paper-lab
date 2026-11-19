import { contentOf, currentArtifact } from '@/core/autoresearch/artifacts';
import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { searchQueries } from '@/core/autoresearch/validation';

export function referenceLabels(run: Run) {
  const content = <K extends Stage>(stage: K) => {
    const artifact = currentArtifact(run, stage);
    return artifact ? contentOf(stage, artifact) : undefined;
  };
  const plan = content('S3');
  const queries = new Map(plan ? searchQueries(plan).map((q) => [q.id, q.query]) : []);
  const hypotheses = content('S8');
  const hypothesisLabels = new Map(hypotheses?.hypotheses.map((h) => [h.id, h.statement]));
  const papers = new Map([
    ...(content('S4')?.candidates.map((p) => [p.id, p.title] as const) ?? []),
    ...(hypotheses?.retrievedPapers.map((p) => [p.id, p.title] as const) ?? []),
  ]);
  const cards = new Map(
    content('S6')?.cards.map((c) => [c.id, c.findings ?? c.problem ?? c.method ?? 'Thẻ kiến thức']),
  );
  return new Map<string, Map<string, string>>([
    ['subQuestionIds', new Map(content('S2')?.subQuestions.map((q) => [q.id, q.question]))],
    ['queryId', queries],
    ['queryIds', queries],
    ['paperId', papers],
    ['paperIds', papers],
    ['decisionId', new Map(content('S5')?.decisions.map((d) => [d.id, papers.get(d.paperId) ?? d.reason]))],
    ['cardId', cards],
    ['cardIds', cards],
    ['evidenceRefs', cards],
    ['gapId', new Map(content('S7')?.gaps.map((g) => [g.id, g.text]))],
    ['hypothesisId', hypothesisLabels],
    ['hypothesisIds', hypothesisLabels],
    ['claimId', new Map(content('S9')?.claims.map((claim) => [claim.id, claim.text]))],
  ]);
}
