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
  identifiers: z.object({
    doi: z.string().optional(),
    openalexId: z.string().optional(),
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
