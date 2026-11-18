// Imported by the worker too, so only relative imports here (the worker has no `@/` alias).
import { z } from 'zod';
import {
  ScgContributionTypeSchema,
  type ScgContribution,
  type ScgPaperRun,
  type ScgReference,
} from '../schemas/scg';

/**
 * `paperlab-scg-paper` v1: one paper's contribution graph as PaperLab publishes it through the worker
 * (`PUT /v1/papers/:id/scg`). Rejected contributions, prerequisites and matches are left out; what is
 * left keeps its review state, so a reader can tell a candidate from an accepted item. Evidence is the
 * content keys of the published paper model's sentences, never text: a reader takes the sentence text
 * from `GET /v1/papers/:id/model`.
 */
export const SCG_PAPER_FORMAT = 'paperlab-scg-paper';

const PublishedPaperIdSchema = z
  .string()
  .regex(/^(sha256-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u);
const SentenceKeysSchema = z.array(z.string().regex(/^[0-9a-f]{16}#\d+$/u)).min(1);
const ContributionIdSchema = z.string().regex(/^.+\.c\d+$/u);
const PublishedReviewSchema = z.enum(['candidate', 'accepted']);

export const ScgPublishedReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('paper'),
    refId: z.string().nullable(),
    title: z.string().min(1),
    year: z.number().int().nullable(),
    doi: z.string().nullable(),
    s2CorpusId: z.string().nullable(),
  }),
  z.strictObject({ kind: z.literal('contribution'), contributionId: ContributionIdSchema }),
  z.strictObject({ kind: z.literal('tool'), url: z.url() }),
]);
export const ScgPublishedMatchSchema = z.strictObject({
  /** A contribution of another lab paper. */
  contributionId: ContributionIdSchema,
  explanation: z.string(),
  matchType: z.enum(['strong', 'weak']),
  review: PublishedReviewSchema,
});
export const ScgPublishedPrerequisiteSchema = z.strictObject({
  id: z.string().regex(/^.+\.c\d+\.p\d+$/u),
  name: z.string().min(1),
  description: z.string(),
  explanation: z.string(),
  coreOrPeripheral: z.enum(['core', 'peripheral']),
  references: z.array(ScgPublishedReferenceSchema),
  matches: z.array(ScgPublishedMatchSchema),
  sourceSentenceKeys: SentenceKeysSchema,
  review: PublishedReviewSchema,
});
export const ScgPublishedContributionSchema = z.strictObject({
  id: ContributionIdSchema,
  name: z.string().min(1),
  description: z.string(),
  types: z.array(z.strictObject({ type: ScgContributionTypeSchema, explanation: z.string() })).min(1),
  sections: z.array(z.string()),
  prerequisites: z.array(ScgPublishedPrerequisiteSchema),
  sourceSentenceKeys: SentenceKeysSchema,
  review: PublishedReviewSchema,
});
export const ScgPaperPublishSchema = z.strictObject({
  format: z.literal(SCG_PAPER_FORMAT),
  schemaVersion: z.literal(1),
  /** The id the paper model is published under (`sha256-<hex>` of the file, or the local UUID). */
  paperId: PublishedPaperIdSchema,
  doi: z.string().nullable(),
  s2CorpusId: z.string().nullable(),
  /** Prefix of the contribution ids: the S2 corpus id when known at the first run, else the local paper id. */
  idBase: z.string().min(1),
  promptVersion: z.string(),
  promptVersions: z.strictObject({
    contributions: z.string(),
    prerequisites: z.string(),
    alignment: z.string(),
  }),
  requestedModel: z.string(),
  model: z.string(),
  /** When the extraction run started. There is no publish time in the body, so the same graph has the same ETag. */
  createdAt: z.iso.datetime(),
  contributions: z.array(ScgPublishedContributionSchema),
});
export type ScgPaperPublish = z.infer<typeof ScgPaperPublishSchema>;

/** The record to publish for a finished run: rejected items dropped, along with references to them. */
export function projectScgPaper(run: ScgPaperRun, publishedId: string): ScgPaperPublish {
  const kept = run.contributions.filter((contribution) => contribution.review !== 'rejected');
  const keptIds = new Set(kept.map((contribution) => contribution.id));
  const reference = (item: ScgReference): ScgReference =>
    item.kind === 'paper'
      ? {
          kind: 'paper',
          refId: item.refId,
          title: item.title,
          year: item.year,
          doi: item.doi,
          s2CorpusId: item.s2CorpusId,
        }
      : item.kind === 'contribution'
        ? { kind: 'contribution', contributionId: item.contributionId }
        : { kind: 'tool', url: item.url };
  const contribution = (item: ScgContribution) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    types: item.types.map(({ type, explanation }) => ({ type, explanation })),
    sections: [...item.sections],
    prerequisites: item.prerequisites
      .filter((prerequisite) => prerequisite.review !== 'rejected')
      .map((prerequisite) => ({
        id: prerequisite.id,
        name: prerequisite.name,
        description: prerequisite.description,
        explanation: prerequisite.explanation,
        coreOrPeripheral: prerequisite.coreOrPeripheral,
        references: prerequisite.references
          .filter((ref) => ref.kind !== 'contribution' || keptIds.has(ref.contributionId))
          .map(reference),
        matches: prerequisite.matches
          .filter((match) => match.review !== 'rejected')
          .map((match) => ({
            contributionId: match.contributionId,
            explanation: match.explanation,
            matchType: match.matchType,
            review: match.review as 'candidate' | 'accepted',
          })),
        sourceSentenceKeys: [...prerequisite.sourceSentenceKeys],
        review: prerequisite.review as 'candidate' | 'accepted',
      })),
    sourceSentenceKeys: [...item.sourceSentenceKeys],
    review: item.review as 'candidate' | 'accepted',
  });
  return ScgPaperPublishSchema.parse({
    format: SCG_PAPER_FORMAT,
    schemaVersion: 1,
    paperId: publishedId,
    doi: run.doi,
    s2CorpusId: run.s2CorpusId,
    idBase: run.idBase,
    promptVersion: run.promptVersion,
    promptVersions: { ...run.promptVersions },
    requestedModel: run.requestedModel,
    model: run.model,
    createdAt: run.createdAt,
    contributions: kept.map(contribution),
  });
}

/** The ETag of a published graph: SHA-256 hex of the exact UTF-8 bytes sent, which the worker also hashes. */
export async function scgBodyEtag(body: string | ArrayBuffer): Promise<string> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
