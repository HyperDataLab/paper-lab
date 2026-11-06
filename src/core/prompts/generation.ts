import { z } from 'zod';
import { SENTENCE_ROLES } from '../schemas/paragraph';

export const GenerationInputSchema = z.object({
  mainClaim: z.string().refine((value) => value.trim().length > 0),
  evidence: z
    .array(z.object({ id: z.string().min(1), text: z.string().min(1), citation: z.string().nullable() }))
    .min(1)
    .max(12)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  audience: z.enum(['specialist', 'general', 'student']),
  structure: z.enum(['TS-D', 'LD', 'LDR', 'OCAR', 'auto']),
  preserveTerms: z.array(z.string()),
  hedging: z.enum(['keep_as_given', 'cautious']),
});
export type GenerationInput = z.infer<typeof GenerationInputSchema>;
export const GenerationOutputSchema = z.object({
  paragraph: z.string().min(1),
  sentences: z
    .array(
      z.object({
        text: z.string().min(1),
        role: z.enum(SENTENCE_ROLES),
        evidenceIds: z.array(z.string()),
        usesClaim: z.boolean(),
      }),
    )
    .min(1),
  needsEvidence: z.array(z.object({ note: z.string() })),
});
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;
export function buildGenerationPrompt(input: GenerationInput) {
  return {
    system:
      'Write one English scientific paragraph that states the main claim and supports it only with the listed evidence items. Cite each item’s citation exactly as given when it is used. Keep numbers, units, hedges and negation exactly. Add no new facts, numbers, citations, methods or causal claims beyond the evidence. Follow the requested Schimel structure: TS-D has the topic sentence first; LD leads to its point; LDR adds a resolution; OCAR follows opening, challenge, action, resolution. Use Topic–Action–Stress order and stress to topic links between sentences. Tag each sentence with the evidence ids it uses and whether it uses the claim. Use needsEvidence when support is missing and write its notes in Vietnamese. Keep preserveTerms verbatim. Return rationale-free JSON without offsets.',
    user: JSON.stringify(GenerationInputSchema.parse(input)),
  };
}
