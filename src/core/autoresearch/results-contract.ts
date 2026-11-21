import { z } from 'zod';
import { text } from './stage-fields';

export const lockSchema = z.strictObject({
  planVersion: z.number().int().positive(),
  etag: z.string().regex(/^[0-9a-f]{64}$/u),
  frozenAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().optional(),
});
export const resultsLogSchema = z.strictObject({
  runs: z
    .array(
      z.strictObject({
        runId: text,
        condition: text,
        dataset: text,
        seed: z.number().int().nonnegative().optional(),
        metrics: z.record(text, z.number()),
      }),
    )
    .min(1),
  notes: z.string().optional(),
});
export type ResultsLog = z.infer<typeof resultsLogSchema>;

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const resultsImportSchema = z.strictObject({
  hash,
  etag: lockSchema.shape.etag,
  log: resultsLogSchema,
});
export type ResultsImport = z.infer<typeof resultsImportSchema>;
export const verdictSchema = z.enum(['supported', 'refuted', 'inconclusive']);
const probability = z.number().min(0).max(1).nullable();
export const recommendationSchema = z.enum(['proceed', 'refine', 'pivot']);
export const interpretationSchema = z.strictObject({ narrative: text, recommendation: recommendationSchema });
export const s12Schema = z.strictObject({
  resultsHash: hash,
  table: z
    .array(
      z.strictObject({
        condition: text,
        dataset: text,
        metric: text,
        n: z.number().int().nonnegative(),
        mean: z.number().nullable(),
        sd: z.number().nonnegative().nullable(),
      }),
    )
    .min(1),
  tests: z
    .array(
      z.strictObject({
        hypothesisId: text,
        test: text,
        dataset: text,
        metric: text.nullable(),
        conditions: z.array(text),
        statistic: z.number().nullable(),
        p: probability,
        corrected: probability,
        verdict: verdictSchema,
        reason: text.nullable(),
      }),
    )
    .min(1),
  hypotheses: z.array(z.strictObject({ hypothesisId: text, verdict: verdictSchema })).min(1),
  ...interpretationSchema.shape,
});
export type ResultsArtifact = z.infer<typeof s12Schema>;
export type ResultsTest = ResultsArtifact['tests'][number];
export type ComputedResults = Pick<ResultsArtifact, 'table' | 'tests'>;
