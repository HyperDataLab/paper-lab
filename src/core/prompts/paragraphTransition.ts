import { z } from 'zod';
import { CONTINUITIES, RELATIONS } from '../schemas/paragraph';
import type { TransitionPair } from '../schemas/paperOverview';

export const TransitionOutputSchema = z.object({
  pairs: z.array(
    z.object({
      pairId: z.string(),
      continuity: z.enum(CONTINUITIES),
      discourseRelation: z.enum(RELATIONS),
      linked: z.boolean(),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    }),
  ),
});
export function buildParagraphTransitionPrompt(pairs: TransitionPair[]) {
  if (pairs.length > 12) throw new Error('At most 12 transition pairs per call');
  return {
    system:
      'Classify each transition only. Judge continuity and discourse relation; use other only when the rationale names the relation, otherwise use none. Do not return offsets or rewrite text. Write rationale in Vietnamese.',
    user: pairs
      .map(
        (p) =>
          `${p.pairId} | ${p.sectionRole} | ${JSON.stringify(p.from.sentence)} (stress: ${JSON.stringify(p.from.quote)}) → ${JSON.stringify(p.to.sentence)} (topic: ${JSON.stringify(p.to.quote)})`,
      )
      .join('\n'),
  };
}
