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

/** A model's screening suggestion. A corpus member keeps the same shape per screening stage. */
export const CandidateSuggestionSchema = z.object({
  decision: z.enum(['included', 'excluded', 'uncertain']),
  reason: z.string(),
  /** Screening triage scores (0–1); a suggestion without them has not been triaged. */
  relevance: z.number().min(0).max(1).optional(),
  quality: z.number().min(0).max(1).nullable().optional(),
  /** Criterion ids (I1…, E1…) the paper meets or, for exclusion criteria, matches. */
  matched: z.array(z.string()).optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
});
export type CandidateSuggestion = z.infer<typeof CandidateSuggestionSchema>;

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
  /** OpenAlex keywords and work type, kept when the work has them; screening triage reads them. */
  keywords: z.array(z.string()).optional(),
  workType: z.string().optional(),
  status: ScreeningStatusSchema,
  /** The model's suggestion. The status changes only when a person decides. */
  suggestion: CandidateSuggestionSchema.nullable(),
  reason: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** `ai_accepted` when a person applied the AI triage bucket; the decision is still theirs. */
  decidedBy: z.enum(['person', 'ai_accepted']).optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const GroundingQuoteSchema = z.object({
  paragraphId: z.string().nullable(),
  section: z.string().nullable(),
  page: z.number().int().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string(),
});
/**
 * One citation of a claim, grounded in the matrix value it rests on. The quotes are the passages code
 * found in the paper for that value, copied when the synthesis was made.
 */
export const GroundedCitationSchema = z.object({
  paperKey: z.string(),
  fieldKey: z.string(),
  fieldLabel: z.string(),
  value: z.string(),
  /** True when the value was read from the full text, false when only the abstract was available. */
  fullText: z.boolean(),
  /** True when a person verified the value in the matrix. */
  humanVerified: z.boolean(),
  quotes: z.array(GroundingQuoteSchema),
});
export type GroundedCitation = z.infer<typeof GroundedCitationSchema>;

export const SynthesisClaimSchema = z.object({
  kind: z.enum(['theme', 'agreement', 'disagreement', 'gap']),
  text: z.string(),
  paperKeys: z.array(z.string()),
  caveat: z.string().nullable(),
  /** False when none of the cited papers is in the matrix; such a claim is shown as unsupported. */
  supported: z.boolean(),
  /** Empty for a synthesis made before citation grounding. */
  citations: z.array(GroundedCitationSchema).default([]),
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
/** Screening triage, one row per paper label (P1…). Every field is required; scores may be null. */
export const TriageOutputSchema = z.object({
  papers: z.array(
    z.object({
      label: z.string(),
      relevance: z.number().nullable(),
      quality: z.number().nullable(),
      decision_suggestion: z.enum(['include', 'exclude', 'unsure']),
      matched_criteria: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;
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
