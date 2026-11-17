import { z } from 'zod';

const count = z.number().int().nonnegative();
const share = z.number().min(0).max(1);
export const CorpusTopicsSchema = z
  .object({
    format: z.literal('paperlab-corpus-topics'),
    schemaVersion: z.literal(1),
    snapshotId: z.string().min(1),
    createdAt: z.iso.datetime(),
    corpora: z.array(
      z.object({
        corpusId: z.string(),
        releaseId: z.string().optional(),
        kind: z.enum(['journal', 'control', 'topic']),
        title: z.string(),
      }),
    ),
    pipeline: z.object({
      tag: z.string(),
      embeddingModel: z.string(),
      parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      seed: z.number().int(),
      textSource: z.enum(['abstract', 'full-text']),
      openalexFetchedAt: z.iso.datetime(),
    }),
    quality: z.object({
      nmiVsOpenalexSubfield: share.optional(),
      outlierShare: share,
      stability: z.object({ comparedSeed: z.number().int(), matchedTopicShare: share }).optional(),
    }),
    topics: z.array(
      z.object({
        topicId: z.number().int().nonnegative(),
        size: count,
        byCorpus: z.record(z.string(), count),
        words: z.array(z.string()).max(10),
        representativeMemberIds: z.array(z.string()).max(5),
        openalexSubfields: z
          .array(
            z.object({
              name: z.string(),
              /** OpenAlex short id `subfields/<n>`, when the source records carry it. */
              id: z
                .string()
                .regex(/^subfields\/\d+$/u)
                .optional(),
              count,
            }),
          )
          .max(3),
      }),
    ),
    members: z.array(
      z.object({
        corpusId: z.string(),
        memberId: z.string(),
        topicId: z.number().int().min(-1),
        probability: share.nullable(),
        weak: z.boolean(),
        fit: z.number().min(-1).max(1).nullable().optional(),
        weakReason: z.enum(['closer-to-other-topic', 'low-fit', 'unassigned']).nullable().optional(),
        keyphrases: z.array(z.string()).max(8),
        textUsed: z.enum(['abstract', 'title-only', 'none']),
      }),
    ),
  })
  .refine(
    (value) => new Set(value.topics.map((topic) => topic.topicId)).size === value.topics.length,
    'topicId must be unique',
  )
  .refine(
    (value) => value.members.every((member) => member.topicId !== -1 || member.weak),
    'unassigned members must be weak',
  );
export type CorpusTopics = z.infer<typeof CorpusTopicsSchema>;

export const TopicNameSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string(),
  topicId: z.number().int().nonnegative(),
  promptVersion: z.string(),
  candidateName: z.string(),
  candidateDescription: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
});
export type TopicName = z.infer<typeof TopicNameSchema>;
