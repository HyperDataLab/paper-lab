import { z } from 'zod';
import { NCG_UNITS } from './ncgUnits';
const unit = z.enum(NCG_UNITS);
const sentence = z.object({
  sentenceId: z.string(),
  unit,
  phrases: z.array(z.string().min(1)),
  triples: z.array(z.object({ subject: z.string(), predicate: z.string(), object: z.string(), unit })),
});
export const ContributionOutputSchema = z.object({
  domain: z.enum(['ml_nlp', 'other']),
  sentences: z.array(sentence),
});
export const ContributionRunSchema = ContributionOutputSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  model: z.string(),
  promptVersion: z.string(),
  callsUsed: z.number().int().nonnegative(),
  droppedPhrases: z.number().int().nonnegative(),
  droppedTriples: z.number().int().nonnegative(),
});
export const ContributionPendingSchema = z.object({
  keys: z.array(z.string()),
  promptVersion: z.string(),
  requestedModel: z.string(),
  model: z.string(),
  callsUsed: z.number().int().nonnegative(),
  chunks: z.record(
    z.string(),
    ContributionOutputSchema.extend({
      droppedPhrases: z.number().int().nonnegative(),
      droppedTriples: z.number().int().nonnegative(),
    }),
  ),
});
export type ContributionOutput = z.infer<typeof ContributionOutputSchema>;
export type ContributionRun = z.infer<typeof ContributionRunSchema>;
export type ContributionPending = z.infer<typeof ContributionPendingSchema>;
