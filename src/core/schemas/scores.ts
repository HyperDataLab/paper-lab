import { z } from 'zod';
export const ScoresSchema = z.object({
  rubricVersion: z.string(),
  dimensions: z.array(
    z.object({
      id: z.enum([
        'sentence_structure',
        'verb_word_choice',
        'concision_modifiers',
        'paragraph_organization',
        'flow_coherence',
      ]),
      label: z.string(),
      weight: z.number(),
      applicable: z.boolean(),
      notAssessableReason: z.string().nullable(),
      rubric: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
      score: z.number().nullable(),
      descriptor: z.string().nullable(),
      confidence: z.number().nullable(),
      evidence: z.object({ issueIds: z.array(z.string()), sentenceIds: z.array(z.string()) }),
      rationale: z.string().nullable(),
    }),
  ),
  overall: z.number().nullable(),
  overallSuppressedReason: z.string().nullable(),
  coverage: z.object({ applicable: z.number(), total: z.number(), value: z.number() }),
  confidence: z.number().nullable(),
  contextLimited: z.boolean(),
  issueSnapshot: z.string(),
});
export type Scores = z.infer<typeof ScoresSchema>;
