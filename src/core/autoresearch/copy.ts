import { addHypothesis } from '../researchDesign/draft/ops';
import type { Draft } from '../researchDesign/draft/schema';
import { acceptedInputs, currentArtifact, selectedContent } from './artifacts';
import type { Run } from './record';

export function copyHypotheses(draft: Draft, run: Run): Draft {
  const artifact = currentArtifact(run, 'S8');
  if (artifact?.status !== 'accepted') return draft;
  const questions = acceptedInputs(run, 'S8').S2?.subQuestions ?? [];
  let next = draft;
  for (const h of selectedContent('S8', artifact).hypotheses) {
    if (
      next.hypotheses.some(
        (existing) =>
          existing.statement === h.statement ||
          (existing.autoresearch?.artifactHash === artifact.hash &&
            existing.autoresearch.hypothesisId === h.id),
      )
    )
      continue;
    const sourceQuestions = questions.filter((question) => h.subQuestionIds.includes(question.id));
    const question = next.questions.find((q) => sourceQuestions.some((source) => source.question === q.text));
    const result = addHypothesis(next, {
      statement: h.statement,
      kind: h.prediction === '≠ 0' ? 'non_directional' : 'directional',
      question: question?.id ?? null,
      claim: null,
    });
    if (!result.ok) continue;
    const id = `h-${next.next.h}`;
    next = {
      ...result.doc,
      hypotheses: result.doc.hypotheses.map((item) =>
        item.id === id
          ? {
              ...item,
              autoresearch: {
                runId: run.id,
                artifactHash: artifact.hash,
                hypothesisId: h.id,
                primary: artifact.primaryId === h.id,
                status: 'candidate',
              },
            }
          : item,
      ),
    };
  }
  return next;
}

export function confirmCopiedHypothesis(draft: Draft, id: string): Draft {
  return {
    ...draft,
    hypotheses: draft.hypotheses.map((item) =>
      item.id === id && item.autoresearch
        ? { ...item, autoresearch: { ...item.autoresearch, status: 'accepted' } }
        : item,
    ),
  };
}
