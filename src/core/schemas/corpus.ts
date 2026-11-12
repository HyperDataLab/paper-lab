import { z } from 'zod';

const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const years = z.array(z.number().int());
const journalBody = z.object({
  venues: z.array(
    z.object({ name: z.string(), issn: z.array(z.string()), openalexSourceId: z.string().optional() }),
  ),
  years,
  articleTypes: z.array(z.string()),
  versionOfRecordOnly: z.boolean(),
  samplingRule: z.string(),
  seed: z.string(),
  strata: z.array(z.string()),
  capPerIssue: count.nullable(),
  exclusions: z.array(z.string()),
});
const topicBody = z.object({
  researchQuestion: z.string(),
  inclusion: z.array(z.string()),
  exclusion: z.array(z.string()),
  years,
});
export const CorpusProtocolVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: timestamp,
  body: z.union([journalBody, topicBody]),
});
const search = z.union([
  z.object({
    source: z.string(),
    requestUrl: z.string(),
    params: z.record(z.string(), z.string()),
    runAt: timestamp,
    totalReported: count,
    retrieved: count,
    duplicates: count,
    added: count,
    truncated: z.boolean(),
    updateRound: count,
  }),
  z.object({ fileName: z.string(), format: z.enum(['ris', 'csv']), records: count }),
]);
const memberId = z.uuid();
export const CorpusMemberSchema = z.object({
  memberId,
  title: z.string().optional(),
  identifiers: z.object({
    doi: z.string().optional(),
    doiAliases: z.array(z.string()).optional(),
    openalexId: z.string().optional(),
    openalexIdAliases: z.array(z.string()).optional(),
    sha256: z.array(z.string()),
    paperIds: z.array(z.string()),
    libraryIds: z.array(z.string()),
  }),
  exportId: z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/u),
  role: z.enum(['build', 'held_out']).nullable(),
  stratum: z.object({
    year: z.number().int().optional(),
    articleType: z.string().optional(),
    issue: z.string().optional(),
    specialIssue: z.boolean().optional(),
  }),
  version: z.enum(['publishedVersion', 'acceptedVersion', 'submittedVersion']).nullable(),
  retrieval: z.enum(['sought', 'retrieved', 'not_retrieved']),
  retrievalReason: z.string().optional(),
  textRead: z.enum(['FULL_TEXT', 'ABSTRACT_ONLY', 'METADATA_ONLY']),
  authorIds: z.array(z.string()),
  countries: z.array(z.string()),
  decisions: z.array(
    z.object({
      stage: z.enum(['title-abstract', 'full-text']),
      decision: z.enum(['include', 'exclude', 'uncertain']),
      reasonCode: z.string(),
      reasonText: z.string(),
      decider: z.object({ kind: z.enum(['person', 'ai-suggestion']), name: z.string().optional() }),
      at: timestamp,
    }),
  ),
  appraisal: z.array(
    z.object({
      tool: z.string(),
      domain: z.string(),
      judgement: z.string(),
      quote: z.string().optional(),
      appraiser: z.string(),
      at: timestamp,
    }),
  ),
  inputs: z
    .object({
      textHashes: z.array(z.string()),
      metadataDigest: z.string(),
      insightRunIds: z.array(z.string()),
      stanceRunIds: z.array(z.string()),
      segmenterVersion: z.string(),
      sentenceKeyVersion: z.string(),
    })
    .nullable(),
});
const labelScheme = z.enum(['rhetoric', 'stance', 'arguments']);
const labelCount = z.object({ done: count, failed: count, skipped: count });
const corpusFields = {
  format: z.literal('paperlab-corpus'),
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
  searches: z.array(search),
  members: z.array(CorpusMemberSchema),
  runs: z.array(
    z.object({
      scheme: z.string(),
      model: z.string(),
      promptVersion: z.string(),
      done: count,
      failed: count,
      skipped: count,
      createdAt: timestamp,
    }),
  ),
  labelChecks: z
    .array(
      z.object({
        scheme: labelScheme,
        memberId,
        sentenceKey: z.string(),
        label: z.string(),
        verdict: z.enum(['correct', 'incorrect', 'unsure']),
        checker: z.string(),
        at: timestamp,
      }),
    )
    .optional(),
  releases: z.array(
    z.object({
      id: z.string(),
      createdAt: timestamp,
      protocolVersion: z.number().int().positive(),
      digest: z.string(),
      memberCount: count,
      registryVersion: z.string().nullable(),
    }),
  ),
  aliases: z.array(z.object({ from: memberId, into: memberId, at: timestamp, reason: z.string() })),
  pendingConfirmations: z
    .array(
      z.object({
        id: z.uuid(),
        candidate: memberId,
        input: z.object({
          memberId: z.string().optional(),
          doi: z.string().nullable().optional(),
          openalexId: z.string().nullable().optional(),
          sha256: z.string().nullable().optional(),
          paperId: z.string().nullable().optional(),
          libraryId: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
          year: z.number().int().nullable().optional(),
        }),
      }),
    )
    .optional(),
  buildQueue: z
    .object({
      status: z.enum(['running', 'paused', 'cancelled', 'complete']),
      pending: z.array(memberId),
      failed: z.array(z.object({ memberId, reason: z.string() })),
    })
    .optional(),
  /** A corpus-wide labelling run in progress: one checkpoint per member, so a reload resumes at the next one. */
  labelQueue: z
    .object({
      status: z.enum(['running', 'paused', 'cancelled', 'complete']),
      schemes: z.array(labelScheme).min(1),
      model: z.string(),
      promptVersions: z.partialRecord(labelScheme, z.string()),
      pending: z.array(memberId),
      counts: z.partialRecord(labelScheme, labelCount),
      failed: z.array(z.object({ memberId, scheme: labelScheme, reason: z.string() })),
      startedAt: timestamp,
    })
    .optional(),
};
const protocolWith = <T extends typeof journalBody | typeof topicBody>(body: T) =>
  z.array(CorpusProtocolVersionSchema.extend({ body }));
export const CorpusSchema = z.discriminatedUnion('kind', [
  z.object({ ...corpusFields, kind: z.literal('journal'), protocol: protocolWith(journalBody) }),
  z.object({ ...corpusFields, kind: z.literal('control'), protocol: protocolWith(journalBody) }),
  z.object({ ...corpusFields, kind: z.literal('topic'), protocol: protocolWith(topicBody) }),
]);
export type Corpus = z.infer<typeof CorpusSchema>;
export type CorpusMember = z.infer<typeof CorpusMemberSchema>;
export type CorpusLabelScheme = z.infer<typeof labelScheme>;
export type CorpusLabelQueue = NonNullable<Corpus['labelQueue']>;
