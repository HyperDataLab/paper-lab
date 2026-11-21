import { z } from 'zod';
import { PaperRunSchema } from '../schemas/paperRun';

const PartsSchema = z.record(z.string(), z.array(z.string()).min(1));
export type Parts = z.infer<typeof PartsSchema>;

export const PaperRunManifestSchema = PaperRunSchema.omit({
  plan: true,
  items: true,
  calibrationSnapshots: true,
  transitionDone: true,
}).extend({ parts: PartsSchema, writeId: z.uuid().optional() });

const partRef = { schemaVersion: z.literal(1), id: z.string(), paperId: z.uuid() };
export const PaperCheckpointChunkSchema = z.object({
  ...partRef,
  kind: z.literal('chunk'),
  refId: z.string(),
  hash: z.string(),
  data: z.string().max(120_000),
});
export const MeasurementManifestSchema = z.object({
  ...partRef,
  kind: z.literal('measurement'),
  updatedAt: z.iso.datetime(),
  parts: PartsSchema,
  writeId: z.uuid(),
});
export const PaperCheckpointPartSchema = z.discriminatedUnion('kind', [
  PaperCheckpointChunkSchema,
  MeasurementManifestSchema,
]);
