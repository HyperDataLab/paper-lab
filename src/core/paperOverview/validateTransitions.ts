import { TransitionOutputSchema } from '../prompts/paragraphTransition';
import type { TransitionJudgement, TransitionPair } from '../schemas/paperOverview';

export function validateTransitions(raw: unknown, pairs: TransitionPair[]): TransitionJudgement[] {
  const output = TransitionOutputSchema.parse(raw);
  return pairs.map((pair) => {
    const found = output.pairs.find((item) => item.pairId === pair.pairId);
    if (!found)
      return {
        pairId: pair.pairId,
        continuity: 'shift',
        discourseRelation: 'none',
        linked: false,
        confidence: 0,
        rationale: 'no model output',
        measured: false,
      };
    return {
      ...found,
      discourseRelation:
        found.discourseRelation === 'other' && !found.rationale.trim() ? 'none' : found.discourseRelation,
      measured: true,
    };
  });
}
