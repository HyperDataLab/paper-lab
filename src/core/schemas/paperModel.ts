import { z } from 'zod';
import { PaperParagraphSchema, SectionSchema } from './paper';
import { RhetoricCategorySchema } from './paperInsights';
import { StanceCategorySchema } from './stance';

/** NLPContributionGraph information units (SemEval-2021 Task 11). */
export const NCG_UNITS = [
  'ResearchProblem',
  'Approach',
  'Model',
  'Code',
  'Dataset',
  'ExperimentalSetup',
  'Hyperparameters',
  'Baselines',
  'Results',
  'Tasks',
  'Experiments',
  'AblationAnalysis',
] as const;

export const PaperModelMetadataSchema = z.object({
  title: z.string(),
  /** Names as written; JATS gets `string-name` because surname and given names are not known. */
  authors: z.array(z.string()),
  affiliations: z.array(z.string()),
  doi: z.string().nullable(),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  volume: z.string().nullable(),
  issue: z.string().nullable(),
  pages: z.string().nullable(),
  keywords: z.array(z.string()),
  abstract: z.string().nullable(),
  source: z.enum(['manual', 'openalex', 'library', 'parsed']),
});
export const PaperModelSectionSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  level: z.number().int().positive(),
  role: SectionSchema.shape.role,
  page: z.number().int().positive().nullable(),
});
export const PaperModelBlockSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  kind: PaperParagraphSchema.shape.kind,
  page: z.number().int().positive().nullable(),
  text: z.string(),
  textHash: z.string(),
});
export const PaperModelReferenceSchema = z.object({
  id: z.string().regex(/^ref\d+$/u),
  text: z.string(),
  year: z.number().int().nullable(),
  doi: z.string().nullable(),
});
export const PaperModelSentenceSchema = z.object({
  /** Content key: hash of the normalised text + '#' + occurrence. Labels attach here, not to positions. */
  key: z.string().regex(/^[0-9a-f]{16}#\d+$/u),
  /** `<paragraphId>_s<n>`, for display only: paragraph ids change between imports. */
  displayId: z.string(),
  paragraphId: z.string(),
  sectionId: z.string(),
  page: z.number().int().positive().nullable(),
  /** Code-point offsets in the paragraph text. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
});
const AnnotationBaseSchema = z.object({
  /** Sentence content key; positions are not stable across imports. */
  key: z.string(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** Code points relative to the sentence; null when the label is about the whole sentence. */
  span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).nullable(),
  /** The labelled words as they stand in the sentence. */
  text: z.string(),
  origin: z.enum(['rule', 'ai', 'human']),
  /** `machine` until a reader looks; the screen may treat it as accepted, exports must not. */
  state: z.enum(['machine', 'confirmed', 'rejected']),
  source: z.object({ runId: z.string(), model: z.string(), promptVersion: z.string() }).nullable(),
  /** Label from the independent second pass; never derived from the first. */
  second: z.string().nullable(),
});
export const PaperModelAnnotationSchema = z.discriminatedUnion('scheme', [
  AnnotationBaseSchema.extend({ scheme: z.literal('paperlab-rhetoric'), label: RhetoricCategorySchema }),
  AnnotationBaseSchema.extend({ scheme: z.literal('paperlab-stance'), label: StanceCategorySchema }),
  // Filled from R17c/R17e on; their label sets are fixed by those slices.
  AnnotationBaseSchema.extend({ scheme: z.enum(['coresc', 'az2', 'ncg-unit']), label: z.string() }),
]);
/** One labelling run behind the annotations: how much of it reached the sentence index. */
export const PaperModelAnnotationRunSchema = z.object({
  scheme: z.enum(['paperlab-rhetoric', 'paperlab-stance', 'coresc', 'az2', 'ncg-unit']),
  runId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  createdAt: z.iso.datetime(),
  /** Items in the run. */
  items: z.number().int().nonnegative(),
  /** Items whose words lie outside every indexed sentence (a table, a reference, a heading). */
  skipped: z.number().int().nonnegative(),
});
export const KnowledgePhraseSchema = z.object({
  id: z.string(),
  key: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string(),
});
export const KnowledgeTripleSchema = z.object({
  unit: z.enum(NCG_UNITS),
  /** Phrase ids. */
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  key: z.string(),
});
export const PaperModelSchema = z.object({
  format: z.literal('paperlab-paper-model'),
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  generator: z.object({
    app: z.literal('PaperLab'),
    segmenterVersion: z.string(),
    sentenceKeyVersion: z.string(),
    parserVersion: z.string().nullable(),
  }),
  document: z.object({
    /** The file the model was read from. Re-anchoring trusts labels only between models of the same file. */
    source: z.object({
      kind: z.enum(['pdf', 'latex', 'markdown', 'text']),
      /** SHA-256 of the file as PaperLab recorded it at import; null when it was not recorded. */
      sha256: z.string().nullable(),
      pageCount: z.number().int().positive().nullable(),
    }),
    metadata: PaperModelMetadataSchema,
    sections: z.array(PaperModelSectionSchema),
    blocks: z.array(PaperModelBlockSchema),
    references: z.array(PaperModelReferenceSchema),
  }),
  sentences: z.array(PaperModelSentenceSchema),
  annotations: z.array(PaperModelAnnotationSchema),
  annotationRuns: z.array(PaperModelAnnotationRunSchema),
  knowledge: z.object({
    phrases: z.array(KnowledgePhraseSchema),
    triples: z.array(KnowledgeTripleSchema),
  }),
});
export type PaperModel = z.infer<typeof PaperModelSchema>;
export type PaperModelSentence = z.infer<typeof PaperModelSentenceSchema>;
export type PaperModelSection = z.infer<typeof PaperModelSectionSchema>;
export type PaperModelMetadata = z.infer<typeof PaperModelMetadataSchema>;
export type PaperModelAnnotation = z.infer<typeof PaperModelAnnotationSchema>;
export type PaperModelAnnotationRun = z.infer<typeof PaperModelAnnotationRunSchema>;
