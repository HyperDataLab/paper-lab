import { z } from 'zod';
import { GenerationInputSchema, GenerationOutputSchema } from '../prompts/generation';
import { SpanSchema } from './span';

const CheckSchema = z.object({
  id: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'info']),
  detail: z.string(),
});
export const GenerationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    input: GenerationInputSchema,
    paragraph: z.string().min(1),
    sentences: z.array(GenerationOutputSchema.shape.sentences.element.extend({ span: SpanSchema })),
    needsEvidence: GenerationOutputSchema.shape.needsEvidence,
    checks: z.object({
      overall: z.array(CheckSchema),
      sentences: z.array(
        z.object({ sentenceIndex: z.number().int().nonnegative(), checks: z.array(CheckSchema) }),
      ),
      unanchored: z
        .array(
          z.object({ sentenceIndex: z.number().int().nonnegative(), text: z.string(), check: CheckSchema }),
        )
        .default([]),
      unusedEvidence: z.array(z.string()),
    }),
    promptVersion: z.string(),
    model: z.string(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((generation, context) => {
    const chars = Array.from(generation.paragraph);
    let end = 0;
    generation.sentences.forEach((sentence, index) => {
      if (
        sentence.span.start < end ||
        sentence.span.end > chars.length ||
        chars.slice(sentence.span.start, sentence.span.end).join('') !== sentence.text
      )
        context.addIssue({
          code: 'custom',
          path: ['sentences', index, 'span'],
          message: 'Sentence span does not match paragraph',
        });
      end = sentence.span.end;
    });
  });
export type Generation = z.infer<typeof GenerationSchema>;
