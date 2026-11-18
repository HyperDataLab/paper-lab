import { z } from 'zod';

/**
 * The 17 contribution types of the Scientific Contribution Graph (Jansen 2026, arXiv:2605.15011, Table 5).
 * The identifiers are SCG's own, so a later link to SCG needs no mapping. The explanations are short
 * paraphrases of Table 5, not quotations.
 */
export const SCG_CONTRIBUTION_TYPES = {
  problem_formulation: 'A new task, or a new angle on a known problem.',
  theoretical_insight: 'A new theory or theoretical result from derivation or analysis.',
  conceptual_framework: 'A high-level framework that guides further research.',
  resource_benchmark: 'A benchmark for evaluating performance on a task.',
  resource_dataset: 'A general-purpose dataset, without train/eval splits.',
  tool_system_software: 'Software or an artifact meant mainly for other researchers to use.',
  empirical_evaluation: 'New experimental results, such as a model run on a benchmark.',
  analysis: 'A new analysis of data that yields new insight.',
  models_or_architectures: 'A new model design, or a change to an existing one.',
  techniques_algorithms: 'A new learning, optimization or other algorithm or technique.',
  representational: 'A new way to represent or encode data.',
  research_methods_procedures: 'A new experimental protocol or research procedure.',
  metrics_instruments: 'A new evaluation metric or assessment protocol.',
  position_statement: 'A clear, argued stance on a debated topic.',
  real_world_application: 'A research idea shown to work in a practical setting.',
  society_ethics_policy: 'A contribution on ethical, societal or policy issues.',
  other: 'A contribution not covered by the other types.',
} as const;
export type ScgContributionType = keyof typeof SCG_CONTRIBUTION_TYPES;
export const SCG_TYPE_IDS = Object.keys(SCG_CONTRIBUTION_TYPES) as [
  ScgContributionType,
  ...ScgContributionType[],
];
export const ScgContributionTypeSchema = z.enum(SCG_TYPE_IDS);

export const ScgReviewSchema = z.enum(['candidate', 'accepted', 'rejected']);
/** `<paperKey>.c<n>`, n from 0 as in SCG; paperKey is the S2 corpus id when known, else the PaperLab paper id. */
export const ScgContributionIdSchema = z.string().regex(/^.+\.c\d+$/u);

export const ScgReferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paper'),
    /** The paper model's reference id (`ref<n>`) it was read from; null when it came from elsewhere. */
    refId: z.string().nullable(),
    title: z.string().min(1),
    year: z.number().int().nullable(),
    doi: z.string().nullable(),
    s2CorpusId: z.string().nullable(),
  }),
  /** Another contribution of the same paper. */
  z.object({ kind: z.literal('contribution'), contributionId: ScgContributionIdSchema }),
  z.object({ kind: z.literal('tool'), url: z.url() }),
]);
/**
 * A match of a prerequisite to a contribution of another lab paper. SCG nests matches under a paper
 * reference; PaperLab keeps them on the prerequisite because a lab match need not go through a reference.
 */
export const ScgMatchSchema = z.object({
  contributionId: ScgContributionIdSchema,
  explanation: z.string(),
  matchType: z.enum(['strong', 'weak']),
  review: ScgReviewSchema,
});
export const ScgPrerequisiteSchema = z.object({
  /** `<contributionId>.p<n>`. */
  id: z.string().regex(/^.+\.c\d+\.p\d+$/u),
  name: z.string().min(1),
  description: z.string(),
  /** How the contribution builds on it. */
  explanation: z.string(),
  coreOrPeripheral: z.enum(['core', 'peripheral']),
  references: z.array(ScgReferenceSchema),
  matches: z.array(ScgMatchSchema),
  /** Sentences that state the dependency; an item without one is dropped. */
  sourceSentenceKeys: z.array(z.string()).min(1),
  review: ScgReviewSchema,
});
export const ScgTypeAssignmentSchema = z.object({
  type: ScgContributionTypeSchema,
  /** Why this contribution has this type. */
  explanation: z.string(),
});
export const ScgContributionSchema = z.object({
  id: ScgContributionIdSchema,
  name: z.string().min(1),
  /** About one short paragraph. */
  description: z.string(),
  types: z.array(ScgTypeAssignmentSchema).min(1),
  /** Titles of the sections that mention it. */
  sections: z.array(z.string()),
  prerequisites: z.array(ScgPrerequisiteSchema),
  sourceSentenceKeys: z.array(z.string()).min(1),
  review: ScgReviewSchema,
});
/** Stage-1 output after anchoring, before ids are assigned. */
export const ScgContributionDraftSchema = ScgContributionSchema.omit({
  id: true,
  prerequisites: true,
  review: true,
});
const count = z.number().int().nonnegative();
export const ScgDroppedSchema = z.object({
  /** Quotes that are not in the sentence they name. */
  quotes: count,
  /** Contributions and prerequisites with no anchored quote left. */
  contributions: count,
  prerequisites: count,
  /** Reference ids the paper does not have, or tool URLs that do not parse. */
  references: count,
  /** Matches to a contribution that was not offered as a candidate. */
  matches: count,
});
export const ScgStageSchema = z.enum(['contributions', 'prerequisites', 'alignment', 'complete']);
export const ScgPaperRunSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.string().min(1),
  doi: z.string().nullable(),
  s2CorpusId: z.string().nullable(),
  /** When the S2 lookup answered; null when it has not (no DOI, rate limit, offline). */
  s2CheckedAt: z.iso.datetime().nullable(),
  /** Prefix of the contribution ids, fixed by the first run of a paper so ids never change. */
  idBase: z.string().min(1),
  /** The three prompt versions joined with `+`. */
  promptVersion: z.string(),
  promptVersions: z.object({ contributions: z.string(), prerequisites: z.string(), alignment: z.string() }),
  requestedModel: z.string(),
  model: z.string(),
  /** The stage the run is in; `complete` once alignment is done. */
  status: ScgStageSchema,
  callsUsed: count,
  dropped: ScgDroppedSchema,
  contributions: z.array(ScgContributionSchema),
  /** Checkpoint for resuming: what each stage has finished. */
  progress: z.object({
    /** fnv1a64 over the sentence keys the run read; another value means the paper changed. */
    fingerprint: z.string(),
    /** Stage 1 drafts by batch index. Emptied once ids are assigned. */
    contributionBatches: z.record(z.string(), z.array(ScgContributionDraftSchema)),
    /** Contribution ids whose prerequisites were extracted. */
    prerequisitesDone: z.array(z.string()),
    /** Prerequisite ids that went through alignment. */
    alignmentDone: z.array(z.string()),
  }),
  /** Reviews from the previous run, keyed by name, re-applied to items of the same name. */
  reviewCarry: z.record(z.string(), z.enum(['accepted', 'rejected'])),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/* LLM outputs: flat, every field required and nullable where it may be absent, as strict JSON schema needs. */
const ScgEvidenceOutputSchema = z.object({ sentenceKey: z.string(), quote: z.string() });
export const ScgContributionOutputSchema = z.object({
  contributions: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      types: z.array(z.object({ type: ScgContributionTypeSchema, explanation: z.string() })),
      sections: z.array(z.string()),
      evidence: z.array(ScgEvidenceOutputSchema),
    }),
  ),
});
export const ScgPrerequisiteOutputSchema = z.object({
  prerequisites: z.array(
    z.object({
      contributionId: z.string(),
      name: z.string(),
      description: z.string(),
      explanation: z.string(),
      coreOrPeripheral: z.enum(['core', 'peripheral']),
      /** `ref<n>` ids of the paper's reference list, with the title as written there. */
      references: z.array(z.object({ refId: z.string(), title: z.string().nullable() })),
      internalContributionId: z.string().nullable(),
      toolUrl: z.string().nullable(),
      evidence: z.array(ScgEvidenceOutputSchema),
    }),
  ),
});
export const ScgAlignmentOutputSchema = z.object({
  matches: z.array(
    z.object({
      prerequisiteId: z.string(),
      contributionId: z.string(),
      matchType: z.enum(['strong', 'weak']),
      explanation: z.string(),
    }),
  ),
});

export type ScgContributionOutput = z.infer<typeof ScgContributionOutputSchema>;
export type ScgPrerequisiteOutput = z.infer<typeof ScgPrerequisiteOutputSchema>;
export type ScgAlignmentOutput = z.infer<typeof ScgAlignmentOutputSchema>;
export type ScgReview = z.infer<typeof ScgReviewSchema>;
export type ScgReference = z.infer<typeof ScgReferenceSchema>;
export type ScgMatch = z.infer<typeof ScgMatchSchema>;
export type ScgPrerequisite = z.infer<typeof ScgPrerequisiteSchema>;
export type ScgTypeAssignment = z.infer<typeof ScgTypeAssignmentSchema>;
export type ScgContribution = z.infer<typeof ScgContributionSchema>;
export type ScgContributionDraft = z.infer<typeof ScgContributionDraftSchema>;
export type ScgDropped = z.infer<typeof ScgDroppedSchema>;
export type ScgStage = z.infer<typeof ScgStageSchema>;
export type ScgPaperRun = z.infer<typeof ScgPaperRunSchema>;
