import { z } from 'zod';
import { s9Schema } from './argument-map';
import { s10Schema } from './experiment-design';
import { lockSchema, s12Schema } from './results-contract';
import { cardSchema, collectionMetaSchema, refs, sourceRecordSchema, text, texts } from './stage-fields';
export { cardSchema, evidenceScope, text, texts } from './stage-fields';

export const STAGES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;
export const score = z.number().min(0).max(1).nullable();
export const charterSchema = z.strictObject({
  question: text,
  objectives: texts.min(2).max(4),
  scope_in: refs,
  scope_out: texts,
  success_criteria: refs,
  kill_criteria: texts,
  constraints: texts,
  risk_posture: z.enum(['exploratory', 'confirmatory']),
});
export type Charter = z.infer<typeof charterSchema>;

export const goalSchema = z.strictObject({
  problem: text,
  objective: text,
  scope: refs,
  success_criteria: refs,
  researchable: z.boolean(),
  rejectionReason: text.nullable(),
});
export const s1Schema = z.strictObject({ charter: charterSchema, goal: goalSchema });
const questionSchema = z.strictObject({ id: text, question: text });
const topicScores = z.strictObject({ novelty: score, specificity: score, feasibility: score });
export const decompositionSchema = z.strictObject({
  subQuestions: z.array(questionSchema).min(3),
  scores: topicScores,
  rationale: text,
});
export const s2Schema = decompositionSchema.extend({ overall: score });
export const s3Schema = z.strictObject({
  strategies: z
    .array(
      z.strictObject({
        name: text,
        queries: z.array(z.strictObject({ id: text, query: text, subQuestionIds: refs })).min(1),
      }),
    )
    .min(2),
  yearFilter: z.strictObject({
    from: z.number().int().positive().nullable(),
    to: z.number().int().positive().nullable(),
  }),
  inclusion: refs,
  exclusion: texts,
});

export const candidateSchema = z.strictObject({
  id: text,
  doi: text.nullable(),
  title: text,
  abstract: text.nullable(),
  year: z.number().int().nullable(),
  citationKey: text,
  paper_id: text.optional(),
  cite_key: text.optional(),
  authors: texts.optional(),
  venue: text.nullable().optional(),
  citations: z.number().int().nonnegative().nullable().optional(),
  openalexId: z
    .string()
    .regex(/^W\d+$/u)
    .nullable()
    .optional(),
  source_records: z.array(sourceRecordSchema).min(1).optional(),
  queryIds: refs,
  sources: z
    .array(
      z.strictObject({
        kind: z.enum([
          'lab_kg',
          'openalex',
          'corpus',
          'harvest',
          'project',
          'local_abstract',
          'openalex_abstract',
        ]),
        ref: text,
      }),
    )
    .min(1),
  queryLink: z.enum(['retrieved', 'matched_harvest', 'pool_context']),
  existingDecision: z
    .strictObject({ decision: z.enum(['included', 'excluded', 'uncertain']), reason: text })
    .nullable(),
});
export type ResearchCandidate = z.infer<typeof candidateSchema>;
export const s4Schema = z.strictObject({
  candidates: z.array(candidateSchema),
  meta: collectionMetaSchema.optional(),
});
export const s5Schema = z.strictObject({
  decisions: z.array(
    z.strictObject({
      id: text,
      paperId: text,
      decision: z.enum(['included', 'excluded', 'uncertain']),
      reason: text,
      relevance: score,
      quality: score,
    }),
  ),
  thresholds: z.strictObject({ relevance: score, quality: score }),
});
export const s6Schema = z.strictObject({ cards: z.array(cardSchema) });
export const s7Schema = z.strictObject({
  clusters: z.array(z.strictObject({ label: text, summary: text, cardIds: refs })),
  setAside: z.array(z.strictObject({ cardId: text, reason: text })),
  gaps: z.array(z.strictObject({ id: text, text, subQuestionIds: refs, cardIds: refs })).min(2),
});
export const hypothesisSchema = z.strictObject({
  id: text,
  gapId: text,
  subQuestionIds: refs,
  evidenceRefs: refs,
  statement: text,
  outcome: text,
  estimand: text,
  prediction: z.enum(['> 0', '< 0', '≠ 0']),
  falsification: z.strictObject({ criterion: text, threshold: z.number().nullable() }),
  novelty: z.strictObject({ assessment: text, paperIds: refs }),
  risk: text,
});
export const perspectiveSchema = z.enum(['novelty', 'feasibility', 'soundness']);
const perspective = z.strictObject({ lens: perspectiveSchema, assessment: text, hypothesisIds: refs });
export const hypothesisOutputSchema = z.strictObject({
  hypotheses: z.array(hypothesisSchema).min(2),
  perspectives: z.array(perspective).length(3),
  debateRounds: z.array(z.strictObject({ views: z.array(perspective).length(3) })).max(2),
});
export const s8Schema = hypothesisOutputSchema.extend({
  noveltyMethod: z.literal('heuristic'),
  noveltySearches: z.array(
    z.strictObject({
      queryId: text,
      status: z.enum(['retrieved', 'unavailable']),
      paperIds: texts,
    }),
  ),
  retrievedPapers: z.array(
    z.strictObject({
      id: text,
      title: text,
      abstract: text.nullable(),
      source: z.enum(['pool', 'openalex']),
    }),
  ),
});

export const contracts = {
  S1: s1Schema,
  S2: s2Schema,
  S3: s3Schema,
  S4: s4Schema,
  S5: s5Schema,
  S6: s6Schema,
  S7: s7Schema,
  S8: s8Schema,
  S9: s9Schema,
  S10: s10Schema,
  S11: lockSchema,
  S12: s12Schema,
} as const;
export type StageContent = { [K in Stage]: z.infer<(typeof contracts)[K]> };
export type Inputs = Partial<StageContent>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export const errors = [
  'INVALID_GOAL',
  'TOPIC_BELOW_THRESHOLD',
  'INVALID_SEARCH_PLAN',
  'NO_LITERATURE',
  'EMPTY_SHORTLIST',
  'INVALID_CARDS',
  'NO_CARDS',
  'INVALID_SYNTHESIS',
  'INVALID_HYPOTHESES',
  'INVALID_ARGUMENT_MAP',
  'INVALID_DESIGN',
  'INVALID_RESULTS',
  'LLM_OUTPUT_INVALID',
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'MISSING_INPUT',
  'STAGE_ERROR',
] as const;
export const stageErrorSchema = z.enum(errors);
export type StageError = z.infer<typeof stageErrorSchema>;
