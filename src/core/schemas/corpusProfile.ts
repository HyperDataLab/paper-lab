import { z } from 'zod';

const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const finite = z.number().refine(Number.isFinite, 'must be finite');
const stat = finite.nullable();
const share = z.number().min(0).max(1);
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/u);

export const CorpusProfileSummarySchema = z.object({
  /** Papers with a value for this feature. */
  n: count,
  mean: stat,
  sd: stat,
  median: stat,
  q1: stat,
  q3: stat,
});

export const CorpusProfileComparisonSchema = z.object({
  effectSize: finite,
  effectMetric: z.enum(['cohens_d', 'proportion_difference']),
  /** Percentile bootstrap CI of the effect size itself; null when no resample defines it. */
  ci95Low: stat,
  ci95High: stat,
  /** Two-sided Mann–Whitney U, normal approximation. */
  pValue: share,
  /** Benjamini–Hochberg over every feature of the registry that has a p value. */
  qValue: share,
  bootstrapUnit: z.literal('paper'),
});

const coverage = z.object({
  /** Profiled papers with a value. */
  measured: count,
  /** Profiled papers. */
  papers: count,
});

export const CorpusProfileFeatureSchema = z.object({
  featureId: identifier,
  family: z.enum(['structure', 'paragraph', 'linguistic', 'citation', 'stance', 'rhetorical', 'scientific']),
  section: z.string(),
  metricType: z.enum(['share', 'mean', 'rate', 'prevalence']),
  unit: z.string(),
  extractor: z.enum(['deterministic', 'llm']),
  target: CorpusProfileSummarySchema,
  control: CorpusProfileSummarySchema,
  comparison: CorpusProfileComparisonSchema.nullable(),
  /** For machine-label features: the share of counted labels no person has confirmed; null otherwise or with no labels. */
  machineShare: z.object({ target: share.nullable(), control: share.nullable() }).nullable(),
  coverage: z.object({ target: coverage, control: coverage }),
});

export const CorpusProfileEvidenceSchema = z.object({
  memberExportId: identifier,
  sentenceKey: z.string(),
  /** Owner decision 6: at most 300 characters. */
  excerpt: z.string().max(300),
});

export const CorpusProfilePhraseSchema = z.object({
  phraseId: identifier,
  text: z.string(),
  words: z.number().int().min(1).max(5),
  targetPapers: count,
  controlPapers: count,
  targetPrevalence: share,
  controlPrevalence: share,
  g2: finite.nonnegative(),
  logRatio: finite,
  pValue: share,
  /** Benjamini–Hochberg over every phrase that passed decision 5 (`phrases.tested`). */
  qValue: share,
  evidence: z.array(CorpusProfileEvidenceSchema).max(3),
});

const corpusSide = z.object({
  corpusId: z.string(),
  kind: z.enum(['journal', 'control', 'topic']),
  title: z.string(),
  /** Latest release; null when the corpus was never released. */
  releaseId: z.string().nullable(),
  releaseDigest: z.string().nullable(),
  members: count,
  /** Members held out for the held-out test (C5b); never profiled. */
  heldOut: count,
  /** Retrieved members read in full text, held-out ones included: the size the section 4 minimums apply to. */
  fullText: count,
  /** Build members, retrieved, read in full text, with a paper on this device. */
  profiled: count,
  /** Full-text build members whose paper is not on this device, so they were not profiled. */
  notOnDevice: count,
  /** Full-text members per year bucket, held-out ones included. */
  yearBuckets: z.array(z.object({ from: z.number().int(), to: z.number().int(), papers: count })),
  /** Full-text members with no year in their stratum. */
  withoutYear: count,
});

export const CorpusProfileSchema = z.object({
  format: z.literal('paperlab-corpus-profile'),
  schemaVersion: z.literal(1),
  generatedAt: timestamp,
  registry: z.object({ id: z.string(), version: z.number().int().positive(), digest: z.string() }),
  target: corpusSide,
  control: corpusSide,
  seed: z.number().int().nonnegative(),
  thresholds: z.object({
    alpha: share,
    minCohensD: finite.nonnegative(),
    minProportionDifference: finite.nonnegative(),
    bootstrapResamples: count,
    minPapersPerCorpus: count,
    minPapersPerBucket: count,
    bucketYears: z.number().int().positive(),
  }),
  features: z.array(CorpusProfileFeatureSchema),
  /** q below alpha and |effect| at least the minimum for its metric. */
  distinctiveFeatureIds: z.array(identifier),
  phrases: z.object({
    tokenizerVersion: z.string(),
    normalisation: z.string(),
    rules: z.object({
      maxWords: z.number().int().positive(),
      minTargetPrevalence: share,
      minTargetPapers: count,
      alpha: share,
      top: count,
      maxEvidence: count,
      maxExcerptChars: count,
    }),
    tested: count,
    items: z.array(CorpusProfilePhraseSchema),
  }),
  /** `supported` needs the held-out test (C5b); this builder writes only `exploratory` or `inconclusive`. */
  interpretationStatus: z.enum(['exploratory', 'supported', 'inconclusive']),
  interpretationReason: z.string(),
  /** Written only by the held-out test (C5b); false until then. */
  holdoutVerified: z.boolean(),
  holdout: z
    .object({
      auc: share.nullable(),
      ci95Low: share.nullable(),
      ci95High: share.nullable(),
      nTarget: count,
      nControl: count,
      droppedForAuthorOverlap: count,
      passed: z.boolean(),
      rule: z.string(),
    })
    .optional(),
  confoundChecks: z
    .array(
      z.object({ name: z.string(), target: z.string(), control: z.string(), distance: share.nullable() }),
    )
    .optional(),
  warnings: z.array(z.string()),
  methodNotes: z.array(z.string()),
});

export type CorpusProfile = z.infer<typeof CorpusProfileSchema>;
export type CorpusProfileFeature = z.infer<typeof CorpusProfileFeatureSchema>;

export const StoredCorpusProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    corpusId: z.string(),
    savedAt: timestamp,
    targetDigest: z.string(),
    controlDigest: z.string(),
    profile: CorpusProfileSchema,
  })
  .refine((record) => record.corpusId === record.profile.target.corpusId);
export type StoredCorpusProfile = z.infer<typeof StoredCorpusProfileSchema>;
