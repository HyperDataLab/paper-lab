import { z } from 'zod';

const text = z.string().trim().min(1);
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const planSourceSchema = z.strictObject({
  runId: text,
  designHash: hash,
  charterHash: hash,
  inputHashes: z.array(hash),
});
export const autoResearchContextSchema = planSourceSchema.extend({
  rationale: text,
  baselines: z.array(z.strictObject({ name: text, why: text, citeKey: text.optional() })),
  methods: z.array(z.strictObject({ name: text, hypothesisIds: z.array(text).min(1) })),
  ablations: z.array(z.strictObject({ name: text, removes: text, hypothesisId: text })),
  compute: z.strictObject({ estimate: text, budget: text }),
  licenses: z.array(z.strictObject({ datasetId: text, license: text })),
  hypotheses: z.array(
    z.strictObject({
      id: text,
      sourceId: text,
      outcome: text,
      estimand: text,
      prediction: z.enum(['> 0', '< 0', '≠ 0']),
      criterion: text,
      threshold: z.number().nullable(),
    }),
  ),
});
export type PlanSource = z.infer<typeof planSourceSchema>;
