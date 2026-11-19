import { z } from 'zod';
import { emptyProgress, loopProgressSchema } from './agent-loop';
import {
  cardSchema,
  charterSchema,
  contracts,
  evidenceScope,
  s5Schema,
  STAGES,
  stageErrorSchema,
  stageSchema,
  type Stage,
  text,
  texts,
} from './contracts';
import { criticReportSchema, notebookEntrySchema, obligationSchema, piDecisionSchema } from './reviews';

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const time = z.iso.datetime();
export const artifactSchema = z
  .strictObject({
    stage: stageSchema,
    attempt: z.number().int().positive(),
    schemaVersion: z.literal(1),
    content: z.json(),
    hash,
    charterHash: hash,
    inputHashes: z.array(z.strictObject({ stage: stageSchema, hash })),
    status: z.enum(['draft', 'accepted', 'stale']),
    selectionIds: texts.nullable(),
    selectionHash: hash.nullable(),
    primaryId: text.nullable(),
    evidence_scope: evidenceScope.nullable(),
    author: z.enum(['model', 'person', 'code']),
    model: text.nullable(),
    promptVersion: text.nullable(),
    createdAt: time,
  })
  .superRefine((artifact, context) => {
    if (!contracts[artifact.stage].safeParse(artifact.content).success)
      context.addIssue({ code: 'custom', path: ['content'], message: 'Invalid stage artifact' });
  });
export type Artifact = z.infer<typeof artifactSchema>;
const modelSchema = z.strictObject({
  lead: text,
  critic: text,
  sharedModel: z.boolean(),
  stagePrompt: text.nullable(),
  piPrompt: text,
  criticPrompt: text,
});
const reviewState = z.strictObject({
  stage: stageSchema,
  attempt: z.number().int().nonnegative(),
  state: z.enum(['idle', 'working', 'gate', 'accepted', 'rejected', 'stale']),
  error: stageErrorSchema.nullable(),
  reviewError: stageErrorSchema.nullable(),
  models: modelSchema.nullable(),
  critic: criticReportSchema.nullable(),
  previousCritic: criticReportSchema.nullable(),
  pi: piDecisionSchema.nullable(),
  criticProgress: loopProgressSchema,
  piProgress: loopProgressSchema,
  screeningProgress: s5Schema.shape.decisions,
  cardProgress: z.array(cardSchema),
  cardCursor: z.number().int().nonnegative(),
  cardInputHash: hash.optional(),
  checkpointHash: hash.nullable(),
  at: time.nullable(),
});
export type StageState = z.infer<typeof reviewState>;
export function emptyStage(stage: Stage, attempt: number): StageState {
  return {
    stage,
    attempt,
    state: 'idle',
    error: null,
    reviewError: null,
    models: null,
    critic: null,
    previousCritic: null,
    pi: null,
    criticProgress: emptyProgress,
    piProgress: emptyProgress,
    screeningProgress: [],
    cardProgress: [],
    cardCursor: 0,
    checkpointHash: null,
    at: null,
  };
}
const endReasonSchema = z.enum(['complete', 'with_gaps', 'failed', 'cancelled']);
export type EndReason = z.infer<typeof endReasonSchema>;
const runFields = z.strictObject({
  schemaVersion: z.literal(1),
  id: text,
  projectId: text,
  revision: z.number().int().nonnegative(),
  status: z.enum(['running', 'waiting', 'ended']),
  endReason: endReasonSchema.nullable(),
  charter: charterSchema.nullable(),
  charterHash: hash.nullable(),
  pipeline: z
    .array(reviewState)
    .min(STAGES.length - 1)
    .max(STAGES.length),
  artifacts: z.array(artifactSchema),
  notebook: z.array(notebookEntrySchema),
  obligations: z.array(obligationSchema),
  decisions: z.array(
    z.strictObject({
      stage: stageSchema,
      attempt: z.number().int().nonnegative(),
      action: z.enum(['approve', 'reject', 'charter', 'escalate', 'edit']),
      selectionIds: texts,
      primaryId: text.nullable(),
      note: text.nullable(),
      at: time,
    }),
  ),
  budget: z.strictObject({
    calls: z.number().int().nonnegative(),
    maxCalls: z.number().int().positive(),
    estimatedCost: z.number().nonnegative().nullable(),
  }),
  createdAt: time,
  updatedAt: time,
  endedAt: time.nullable(),
});
export const runSchema = runFields
  .superRefine((run, context) => {
    if (
      run.pipeline.some((row, index) => row.stage !== STAGES[index]) ||
      (run.pipeline.length === STAGES.length - 1 &&
        run.artifacts.some((artifact) => artifact.stage === 'S9')) ||
      (run.status === 'ended') !== (run.endReason !== null) ||
      (run.status === 'ended') !== (run.endedAt !== null) ||
      (run.charter === null) !== (run.charterHash === null)
    )
      context.addIssue({ code: 'custom', message: 'Invalid run state' });
  })
  .transform((run) =>
    // Keep AR1 records and their digests intact, including completed runs in backups.
    run.pipeline.length === STAGES.length
      ? run
      : { ...run, pipeline: [...run.pipeline, emptyStage('S9', 0)] },
  );
export type Run = z.infer<typeof runSchema>;
