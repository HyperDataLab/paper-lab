import { z } from 'zod';

export const PaperSchema = z.object({
  id: z.string(),
  doi: z.string().optional(),
  title: z.string().optional(),
  year: z.number().optional(),
  type: z.string().optional(),
  venue: z.object({ name: z.string().optional() }).optional(),
  cited_by_count: z.number(),
  counts_by_year: z.record(z.string(), z.number()),
  url: z.string(),
  study_design: z.array(z.string()).optional(),
  retracted: z.boolean().optional(),
  shared_by: z.number().optional(),
});
const papers = z.array(PaperSchema).transform((value) => value.slice(0, 15));
export const DuplicationSchema = z.object({
  mode: z.string(),
  neighbours: papers,
  existing_reviews: papers.optional(),
  existing_protocols: papers.optional(),
  prospero_caveat: z.string().optional(),
});
export const SaturationSchema = z.object({
  window: z.string(),
  counts_by_year: z.record(z.string(), z.number()),
  total_estimate: z.number(),
  closest_recent: papers,
});
export const DebateSchema = z.object({
  window: z.string(),
  records_in_window: z.number(),
  recent: papers,
  common_ancestors: papers,
});
export const ImpactSchema = z.object({
  papers: z
    .array(
      z.object({
        ref: z.string(),
        ok: z.boolean(),
        paper: PaperSchema.optional(),
        error: z.string().optional(),
      }),
    )
    .transform((value) => value.slice(0, 15)),
});
export type Paper = z.infer<typeof PaperSchema>;
export const trimDuplication = (output: unknown) => DuplicationSchema.parse(output);
export const trimSaturation = (output: unknown) => SaturationSchema.parse(output);
export const trimDebate = (output: unknown) => DebateSchema.parse(output);
export const trimImpact = (output: unknown) => ImpactSchema.parse(output);
