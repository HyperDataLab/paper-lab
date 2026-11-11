import { DeepResearchSchema } from './deepResearch';
import { z } from 'zod';

export const FieldDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  group: z.string(),
  priority: z.number().int().min(1).max(3),
  description: z.string(),
  instruction: z.string(),
  dataType: z.enum(['text', 'list', 'number']),
  custom: z.boolean(),
  /** A changed instruction is a new version; cells made under an older one are stale. */
  version: z.number().int().positive(),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const ProjectFieldSchema = FieldDefinitionSchema.extend({ hidden: z.boolean() });
export type ProjectField = z.infer<typeof ProjectFieldSchema>;

export const SourceAccessSchema = z.enum(['FULL_TEXT', 'ABSTRACT_ONLY', 'METADATA_ONLY']);
export type SourceAccess = z.infer<typeof SourceAccessSchema>;

export const ProjectPaperSchema = z.object({
  key: z.string(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('paper'), paperId: z.uuid() }),
    z.object({ kind: z.literal('library'), libraryId: z.uuid() }),
    z.object({ kind: z.literal('search'), candidateKey: z.string() }),
  ]),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  doi: z.string().nullable(),
  access: SourceAccessSchema,
  /** Only for abstract-only papers: the text extraction reads, kept so a rerun reads the same source. */
  abstract: z.string().nullable(),
  /** Changes whenever the source text changes, so cells made from an older text show as stale. */
  revision: z.string(),
  screening: z.enum(['included', 'excluded', 'uncertain']),
});
export type ProjectPaper = z.infer<typeof ProjectPaperSchema>;

export const CELL_STATUSES = [
  'EXTRACTED',
  'NEEDS_REVIEW',
  'VERIFIED',
  'NOT_FOUND',
  'NOT_APPLICABLE',
  'INSUFFICIENT_SOURCE',
  'CONFLICT',
  'FAILED',
] as const;
export const CellStatusSchema = z.enum(CELL_STATUSES);
export type CellStatus = z.infer<typeof CellStatusSchema>;

export const CellEvidenceSchema = z.object({
  /** Null for an abstract-only paper, whose text has no paragraphs. */
  paragraphId: z.string().nullable(),
  section: z.string().nullable(),
  page: z.number().int().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string(),
  /** A conflicting passage is shown beside the supporting one, never instead of it. */
  stance: z.enum(['supports', 'conflicts']).default('supports'),
});
export type CellEvidence = z.infer<typeof CellEvidenceSchema>;

export const CellHistorySchema = z.object({
  at: z.iso.datetime(),
  action: z.enum(['extract', 'verify', 'approve', 'edit', 'reject', 'reopen']),
  by: z.enum(['model', 'human']),
  value: z.string().nullable(),
  status: CellStatusSchema,
});

export const ExtractionModeSchema = z.enum(['STANDARD', 'HIGH_QUALITY', 'DEEP_RESEARCH']);
export type ExtractionMode = z.infer<typeof ExtractionModeSchema>;

export const ExtractionCellSchema = z.object({
  paperKey: z.string(),
  fieldKey: z.string(),
  fieldVersion: z.number().int().positive(),
  paperRevision: z.string(),
  runId: z.uuid(),
  mode: ExtractionModeSchema,
  status: CellStatusSchema,
  /** The value shown: the model's, or a reviewer's edit. Null when nothing verified can be shown. */
  value: z.string().nullable(),
  /** What the model returned, kept unchanged even when the value is withheld or edited. */
  aiValue: z.string().nullable(),
  assertion: z.enum(['AUTHOR_REPORTED', 'INFERRED']).nullable(),
  evidence: z.array(CellEvidenceSchema),
  flags: z.array(z.string()),
  sourceAccess: SourceAccessSchema,
  verification: z.enum(['HUMAN', 'AUTOMATED']).nullable(),
  /** The verifier's reading in High Quality mode. It is an automated check, never a human review. */
  verdict: z
    .enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED', 'INDETERMINATE'])
    .nullable()
    .default(null),
  verifierNote: z.string().nullable().default(null),
  history: z.array(CellHistorySchema),
});
export type ExtractionCell = z.infer<typeof ExtractionCellSchema>;

export const ExtractionRunSchema = z.object({
  id: z.uuid(),
  mode: ExtractionModeSchema,
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(['RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']),
  model: z.string(),
  promptVersion: z.string(),
  callsUsed: z.number().int().nonnegative(),
  paperKeys: z.array(z.string()),
  fieldKeys: z.array(z.string()),
  errors: z.array(z.object({ paperKey: z.string(), message: z.string() })),
});
export type ExtractionRun = z.infer<typeof ExtractionRunSchema>;

export const ExtractionProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  paperId: z.uuid().nullable().default(null),
  title: z.string().min(1),
  researchQuestion: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  papers: z.array(ProjectPaperSchema),
  fields: z.array(ProjectFieldSchema),
  runs: z.array(ExtractionRunSchema),
  cells: z.array(ExtractionCellSchema),
  deep: DeepResearchSchema.nullable().default(null),
});
export type ExtractionProject = z.infer<typeof ExtractionProjectSchema>;

export const MatrixOutputSchema = z.object({
  fields: z.array(
    z.object({
      field_key: z.string(),
      status: z.enum(['found', 'not_found', 'not_applicable']),
      value: z.string().nullable(),
      inferred: z.boolean(),
      evidence: z.array(z.object({ paragraphId: z.string(), quote: z.string() })),
    }),
  ),
});
export type MatrixOutput = z.infer<typeof MatrixOutputSchema>;

export const VerifyOutputSchema = z.object({
  checks: z.array(
    z.object({
      field_key: z.string(),
      verdict: z.enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED', 'INDETERMINATE']),
      note: z.string(),
      conflicts: z.array(z.object({ paragraphId: z.string(), quote: z.string() })),
    }),
  ),
});
export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;
