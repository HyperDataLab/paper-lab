import { z } from 'zod';
import { draftSchema, emptyDraft } from '../researchDesign/draft/schema';
import { planSchema } from '../researchDesign/plan/schema';
import { factsDocSchema } from '../researchDesign/facts/factsDoc';

export const ResearchDesignSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: z.uuid(),
    version: z.number().int().nonnegative(),
    draft: draftSchema,
    bankRelease: z.string().nullable(),
    facts: z.record(z.string(), factsDocSchema),
    frozenPlans: z.array(planSchema),
    /** Frozen versions the lab's server has accepted for SRD, keyed by plan version. Absent in older records. */
    publishedPlans: z
      .record(z.string().regex(/^[1-9]\d*$/u), z.strictObject({ publishedAt: z.iso.datetime() }))
      .optional(),
  })
  .refine(
    (record) =>
      record.frozenPlans.every(
        (plan, index) => plan.planId === record.projectId && plan.planVersion === index + 1,
      ),
    'Invalid frozen plan versions',
  )
  .refine(
    (record) =>
      Object.keys(record.publishedPlans ?? {}).every(
        (version) => Number(version) <= record.frozenPlans.length,
      ),
    'Published plan versions must be frozen',
  );
export type ResearchDesign = z.infer<typeof ResearchDesignSchema>;
export function emptyResearchDesign(projectId: string): ResearchDesign {
  return {
    schemaVersion: 1,
    projectId,
    version: 0,
    draft: emptyDraft(),
    bankRelease: null,
    facts: {},
    frozenPlans: [],
  };
}
