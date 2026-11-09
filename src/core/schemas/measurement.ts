import { z } from 'zod';

/** FR-12, plus NOT_CHECKED for a field whose relevant sections were never analysed (PRD §5 rule 3). */
export const FieldStatusSchema = z.enum([
  'REPORTED',
  'INFERRED',
  'DERIVED',
  'NOT_REPORTED',
  'NOT_APPLICABLE',
  'CONTRADICTORY',
  'NOT_CHECKED',
]);
export const PaperTypeSchema = z.enum([
  'EMPIRICAL',
  'SURVEY_SLR',
  'METHOD_THEORETICAL',
  'CASE_STUDY',
  'MIXED',
]);
export const SourceTypeSchema = z.enum(['author_statement', 'ai_interpretation', 'ai_concern']);
export const PROTOCOL_FIELDS = [
  'subject',
  'data',
  'comparison',
  'environment',
  'schedule',
  'repetitions',
  'seeds',
  'statistical_analysis',
  'aggregation',
] as const;
export type ProtocolField = (typeof PROTOCOL_FIELDS)[number];

// Model output. Offsets never come from the model: it gives a quote, code finds it.
const ModelStatusSchema = FieldStatusSchema.exclude(['NOT_CHECKED']);
export const QuoteRefSchema = z.object({
  blockId: z.string(),
  quote: z.string(),
  row: z.number().int().nonnegative().nullable(),
  column: z.number().int().nonnegative().nullable(),
});
export const ModelFieldSchema = z.object({
  value: z.string().nullable(),
  status: ModelStatusSchema,
  quotes: z.array(QuoteRefSchema),
});
export const ClassifyOutputSchema = z.object({
  paper_type: PaperTypeSchema,
  rationale: z.string(),
  quotes: z.array(QuoteRefSchema),
});
const ModelProtocolSchema = z.object(
  Object.fromEntries(PROTOCOL_FIELDS.map((field) => [field, ModelFieldSchema])) as Record<
    ProtocolField,
    typeof ModelFieldSchema
  >,
);
export const ExtractionOutputSchema = z.object({
  constructs: z.array(
    z.object({ key: z.string(), name: z.string(), description: z.string(), quotes: z.array(QuoteRefSchema) }),
  ),
  metrics: z.array(
    z.object({
      key: z.string(),
      reported_name: z.string(),
      aliases: z.array(z.string()),
      construct_keys: z.array(z.string()),
      experiment_keys: z.array(z.string()),
      definition: ModelFieldSchema,
      formula: ModelFieldSchema,
      unit: ModelFieldSchema,
      direction: ModelFieldSchema,
      range: ModelFieldSchema,
      method: z.object({
        input_data: ModelFieldSchema,
        procedure: ModelFieldSchema,
        data_source: ModelFieldSchema,
        aggregation: ModelFieldSchema,
      }),
    }),
  ),
  experiments: z.array(z.object({ key: z.string(), name: z.string(), protocol: ModelProtocolSchema })),
  results: z.array(
    z.object({
      key: z.string(),
      experiment_key: z.string().nullable(),
      metric_key: z.string().nullable(),
      system_or_baseline: z.string(),
      value: z.string(),
      unit: z.string().nullable(),
      uncertainty: z.string().nullable(),
      condition: z.string().nullable(),
      quote: QuoteRefSchema,
    }),
  ),
  claims: z.array(
    z.object({
      key: z.string(),
      text: z.string(),
      quote: QuoteRefSchema,
    }),
  ),
  taxonomy: z.array(
    z.object({
      construct: z.string(),
      metric: z.string(),
      how_measured: ModelFieldSchema,
      domain: ModelFieldSchema,
      quotes: z.array(QuoteRefSchema),
    }),
  ),
  review_method: z
    .object({
      search_strategy: ModelFieldSchema,
      inclusion_criteria: ModelFieldSchema,
      synthesis: ModelFieldSchema,
    })
    .nullable(),
});
export const LinkOutputSchema = z.object({
  metric_merges: z.array(z.object({ ids: z.array(z.string()), reason: z.string() })),
  result_links: z.array(
    z.object({
      result_id: z.string(),
      metric_id: z.string().nullable(),
      experiment_id: z.string().nullable(),
    }),
  ),
  metric_experiments: z.array(z.object({ metric_id: z.string(), experiment_id: z.string() })),
  claim_links: z.array(
    z.object({
      claim_id: z.string(),
      result_ids: z.array(z.string()),
      metric_ids: z.array(z.string()),
      evidence_scope: z.string(),
    }),
  ),
});
export const FindingTypeSchema = z.enum([
  'definition_ambiguity',
  'unit_scale_mismatch',
  'protocol_incompleteness',
  'aggregation_ambiguity',
  'comparability_risk',
  'claim_evidence_gap',
]);
export const FindingsOutputSchema = z.object({
  findings: z.array(
    z.object({
      type: FindingTypeSchema,
      severity: z.enum(['low', 'medium', 'high']),
      explanation: z.string(),
      limitation_of_assessment: z.string(),
      suggested_question_to_author: z.string(),
      related_item_ids: z.array(z.string()),
      evidence_ids: z.array(z.string()),
    }),
  ),
});
export type LinkOutput = z.infer<typeof LinkOutputSchema>;
export type FindingsOutput = z.infer<typeof FindingsOutputSchema>;
export type QuoteRef = z.infer<typeof QuoteRefSchema>;
export type ModelField = z.infer<typeof ModelFieldSchema>;
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

// Verified profile.
export const EvidenceSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  page: z.number().int().positive().nullable(),
  sectionId: z.string(),
  kind: z.enum(['text', 'table', 'figure', 'equation']),
  span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).nullable(),
  cell: z.object({ row: z.number().int().nonnegative(), column: z.number().int().nonnegative() }).nullable(),
  source_excerpt: z.string(),
  needs_review: z.boolean(),
});
export const ProfileFieldSchema = z.object({
  value: z.string().nullable(),
  status: FieldStatusSchema,
  evidence_ids: z.array(z.string()),
  needs_review: z.boolean(),
  search_scope: z.array(z.string()).optional(),
});
export const ConstructSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source_type: SourceTypeSchema,
  evidence_ids: z.array(z.string()),
});
export const MeasurementMethodSchema = z.object({
  input_data: ProfileFieldSchema,
  procedure: ProfileFieldSchema,
  data_source: ProfileFieldSchema,
  aggregation: ProfileFieldSchema,
});
export const MetricUsageSchema = z.object({
  id: z.string(),
  reported_name: z.string(),
  normalized_label: z.string(),
  aliases: z.array(z.string()),
  construct_ids: z.array(z.string()),
  experiment_ids: z.array(z.string()),
  definition: ProfileFieldSchema,
  formula_text: ProfileFieldSchema,
  unit: ProfileFieldSchema,
  direction: ProfileFieldSchema,
  range: ProfileFieldSchema,
  method: MeasurementMethodSchema,
  /** Another usage carries the same name with a different reported definition (FR-17, AC-02). */
  name_collision: z.boolean(),
  evidence_ids: z.array(z.string()),
});
export const ExperimentSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.record(z.enum(PROTOCOL_FIELDS), ProfileFieldSchema),
});
export const ReportedResultSchema = z.object({
  id: z.string(),
  experiment_id: z.string().nullable(),
  metric_usage_id: z.string().nullable(),
  system_or_baseline: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  uncertainty: z.string().nullable(),
  condition: z.string().nullable(),
  source_table_cell: z
    .object({
      blockId: z.string(),
      row: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    })
    .nullable(),
  status: FieldStatusSchema,
  needs_review: z.boolean(),
  review_reasons: z.array(z.string()),
  evidence_ids: z.array(z.string()),
});
export const ResearchClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: FieldStatusSchema,
  needs_review: z.boolean(),
  /** What the linked results actually cover: an AI interpretation, never a proof of the claim. */
  evidence_scope: z.string().nullable(),
  linked_result_ids: z.array(z.string()),
  linked_metric_ids: z.array(z.string()),
  evidence_ids: z.array(z.string()),
});
export const AnalysisFindingSchema = z.object({
  id: z.string(),
  type: FindingTypeSchema,
  severity: z.enum(['low', 'medium', 'high']),
  explanation: z.string(),
  limitation_of_assessment: z.string(),
  suggested_question_to_author: z.string(),
  related_item_ids: z.array(z.string()),
  evidence_ids: z.array(z.string()),
});
export const TaxonomyEntrySchema = z.object({
  id: z.string(),
  construct: z.string(),
  metric: z.string(),
  how_measured: ProfileFieldSchema,
  domain: ProfileFieldSchema,
  evidence_ids: z.array(z.string()),
});
export const MeasurementProfileSchema = z.object({
  schema_version: z.literal('1.0'),
  paper_id: z.uuid(),
  title: z.string(),
  paper_type: PaperTypeSchema,
  paper_type_rationale: z.string(),
  paper_type_evidence_ids: z.array(z.string()),
  status: z.enum(['complete', 'partial']),
  generated_at: z.iso.datetime(),
  model_id: z.string(),
  prompt_version: z.string(),
  parser_version: z.string().nullable(),
  coverage: z.object({
    analysed: z.array(z.string()),
    failed: z.array(z.string()),
    not_selected: z.array(z.string()),
  }),
  steps: z.object({
    link: z.enum(['done', 'failed', 'not_run']),
    findings: z.enum(['done', 'failed', 'not_run']),
  }),
  constructs: z.array(ConstructSchema),
  metrics: z.array(MetricUsageSchema),
  experiments: z.array(ExperimentSchema),
  results: z.array(ReportedResultSchema),
  claims: z.array(ResearchClaimSchema),
  findings: z.array(AnalysisFindingSchema),
  taxonomy: z.array(TaxonomyEntrySchema),
  review_method: z
    .object({
      search_strategy: ProfileFieldSchema,
      inclusion_criteria: ProfileFieldSchema,
      synthesis: ProfileFieldSchema,
    })
    .nullable(),
  evidence: z.array(EvidenceSchema),
  discarded: z.object({
    unverified_quotes: z.number().int().nonnegative(),
    invented_experiments: z.number().int().nonnegative(),
    unsupported_findings: z.number().int().nonnegative(),
    invalid_links: z.number().int().nonnegative(),
  }),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export type ProfileField = z.infer<typeof ProfileFieldSchema>;
export type MetricUsage = z.infer<typeof MetricUsageSchema>;
export type Experiment = z.infer<typeof ExperimentSchema>;
export type ReportedResult = z.infer<typeof ReportedResultSchema>;
export type ResearchClaim = z.infer<typeof ResearchClaimSchema>;
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;
export type MeasurementProfile = z.infer<typeof MeasurementProfileSchema>;

// Review and storage.
export const MeasurementDecisionSchema = z.object({
  run_id: z.uuid(),
  item_id: z.string(),
  field: z.string().nullable(),
  decision: z.enum(['accept', 'edit', 'reject', 'reopen']),
  reviewer: z.literal('local'),
  timestamp: z.iso.datetime(),
  previous_value: z.string().nullable(),
  new_value: z.string().nullable(),
  note: z.string().nullable(),
});
export const MeasurementCheckpointSchema = z.object({
  classification: ClassifyOutputSchema.nullable(),
  units: z.record(z.string(), ExtractionOutputSchema),
  link: LinkOutputSchema.nullable(),
  findings: FindingsOutputSchema.nullable(),
  model: z.string().nullable(),
});
export const MeasurementPendingSchema = z.object({
  sectionIds: z.array(z.string()),
  callsUsed: z.number().int().nonnegative(),
  checkpoint: MeasurementCheckpointSchema,
});
export const MeasurementRunSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  callsUsed: z.number().int().nonnegative(),
  sectionIds: z.array(z.string()),
  profile: MeasurementProfileSchema,
});
export const MeasurementsRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  updatedAt: z.iso.datetime(),
  runs: z.array(MeasurementRunSchema),
  decisions: z.array(MeasurementDecisionSchema),
  pending: MeasurementPendingSchema.nullable(),
});
export type MeasurementDecision = z.infer<typeof MeasurementDecisionSchema>;
export type MeasurementPending = z.infer<typeof MeasurementPendingSchema>;
export type MeasurementRun = z.infer<typeof MeasurementRunSchema>;
export type MeasurementsRecord = z.infer<typeof MeasurementsRecordSchema>;
