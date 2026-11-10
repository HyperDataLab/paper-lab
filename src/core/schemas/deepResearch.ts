import { z } from 'zod';

export const SearchPlanSchema = z.object({
  concepts: z.array(z.string()),
  queries: z.array(z.string()),
  inclusion: z.array(z.string()),
  exclusion: z.array(z.string()),
  fromYear: z.number().int().nullable(),
  toYear: z.number().int().nullable(),
  perQuery: z.number().int().min(1).max(50),
  /** Searching waits for a person to approve the plan. */
  approvedAt: z.iso.datetime().nullable(),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

export const SearchRoundSchema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  kind: z.enum(['query', 'cites', 'cited_by']),
  /** The query text, or the title of the paper whose citations were followed. */
  input: z.string(),
  found: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  note: z.string().nullable(),
});
export type SearchRound = z.infer<typeof SearchRoundSchema>;

export const ScreeningStatusSchema = z.enum(['candidate', 'included', 'excluded', 'uncertain']);
export type ScreeningStatus = z.infer<typeof ScreeningStatusSchema>;

export const CandidateSchema = z.object({
  key: z.string(),
  openalexId: z.string().nullable(),
  doi: z.string().nullable(),
  title: z.string(),
  year: z.number().int().nullable(),
  authors: z.array(z.string()),
  venue: z.string().nullable(),
  abstract: z.string().nullable(),
  citedBy: z.number().int().nonnegative().nullable(),
  foundBy: z.array(z.string()),
  status: ScreeningStatusSchema,
  /** The model's suggestion. The status changes only when a person decides. */
  suggestion: z
    .object({ decision: z.enum(['included', 'excluded', 'uncertain']), reason: z.string() })
    .nullable(),
  reason: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const SynthesisClaimSchema = z.object({
  kind: z.enum(['theme', 'agreement', 'disagreement', 'gap']),
  text: z.string(),
  paperKeys: z.array(z.string()),
  caveat: z.string().nullable(),
  /** False when none of the cited papers is in the matrix; such a claim is shown as unsupported. */
  supported: z.boolean(),
});
export type SynthesisClaim = z.infer<typeof SynthesisClaimSchema>;

export const SynthesisSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  model: z.string(),
  promptVersion: z.string(),
  paperKeys: z.array(z.string()),
  claims: z.array(SynthesisClaimSchema),
  droppedRefs: z.number().int().nonnegative(),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

export const DeepResearchSchema = z.object({
  plan: SearchPlanSchema.nullable(),
  rounds: z.array(SearchRoundSchema),
  candidates: z.array(CandidateSchema),
  syntheses: z.array(SynthesisSchema),
});
export type DeepResearch = z.infer<typeof DeepResearchSchema>;

export const PlanOutputSchema = z.object({
  concepts: z.array(z.string()),
  queries: z.array(z.string()),
  inclusion: z.array(z.string()),
  exclusion: z.array(z.string()),
  fromYear: z.number().int().nullable(),
  toYear: z.number().int().nullable(),
});
export const ScreeningOutputSchema = z.object({
  decisions: z.array(
    z.object({
      key: z.string(),
      decision: z.enum(['included', 'excluded', 'uncertain']),
      reason: z.string(),
    }),
  ),
});
export const SynthesisOutputSchema = z.object({
  claims: z.array(
    z.object({
      kind: z.enum(['theme', 'agreement', 'disagreement', 'gap']),
      text: z.string(),
      paperKeys: z.array(z.string()),
      caveat: z.string().nullable(),
    }),
  ),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type ScreeningOutput = z.infer<typeof ScreeningOutputSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
