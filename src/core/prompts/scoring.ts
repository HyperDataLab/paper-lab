import { z } from 'zod';
import { DIMENSIONS } from '../scoring/rubric';
import type { TextAnalysis } from '../schemas/text';
import { createOffsetIndex } from '../text/offsets';
const ids = DIMENSIONS.map((dimension) => dimension.id) as [
  (typeof DIMENSIONS)[number]['id'],
  ...(typeof DIMENSIONS)[number]['id'][],
];
export const ScoringOutputSchema = z.object({
  dimensions: z.array(
    z.object({
      id: z.enum(ids),
      rubric: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
      confidence: z.number().min(0).max(1).nullable(),
      evidenceIssueIds: z.array(z.string()),
      evidenceSentenceIds: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
});
export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
export function buildScoringPrompt(text: TextAnalysis, packages: unknown, rubric: unknown, context: unknown) {
  const index = createOffsetIndex(text.sourceText);
  const sentences = text.sentences
    .map((sentence) => `${sentence.id} | ${JSON.stringify(index.sliceCp(sentence.start, sentence.end))}`)
    .join('\n');
  return {
    system:
      'Score only the listed applicable dimensions using their descriptors. Prioritise recurring consequential problems over incidental style. Counts are not deductions. Passive voice, hedges and necessary qualifiers are not faults by themselves. Cite issue ids and sentence ids as evidence. Use null when evidence is insufficient. Write rationale in Vietnamese. Never invent issues, numbers or offsets.',
    user: JSON.stringify({ text: text.sourceText, sentences, packages, rubric, context }),
  };
}
