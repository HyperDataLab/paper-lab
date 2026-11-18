import { z } from 'zod';

const registryJournalId = z.string().regex(/^jrn\.\S+$/u);
const journalProfile = z.string().regex(/^jr\.\S+$/u);
const articleTypeId = z.string().regex(/^art\.\S+$/u);
const release = z.string().min(1);

// Writing Bank coordination request 009. The registry and snapshot release are independent.
const journalFields = {
  name: z.string(),
  issnL: z.string().optional(),
  issns: z.array(z.string()),
  openalexSourceId: z
    .string()
    .regex(/^S\d+$/u)
    .nullable(),
  publisher: z.string().optional(),
  fields: z.array(z.string()).optional(),
  profile: journalProfile.optional(),
};
const journal = z.discriminatedUnion('kind', [
  z.object({ ...journalFields, kind: z.literal('journal'), id: registryJournalId }),
  z.object({
    ...journalFields,
    kind: z.literal('conference'),
    id: z.union([registryJournalId, journalProfile]),
  }),
]);
const articleType = z.object({
  id: articleTypeId,
  name: z.string(),
  aliases: z.array(z.string()),
});

export const BankJournalPageSchema = z.object({
  items: z.array(journal),
  nextCursor: z.string().nullable(),
});
export const BankCatalogSnapshotSchema = z.object({
  format: z.literal('writing-bank-snapshot'),
  formatVersion: z.literal(1),
  release,
  collections: z.object({
    'article-types': z.array(articleType),
  }),
});
export const BankCatalogLinkSchema = z.object({
  // Only article types are release-pinned. Accept the profile IDs stored by earlier protocols.
  release: release.optional(),
  journalId: z.union([registryJournalId, journalProfile]).optional(),
  journalProfile: journalProfile.optional(),
  journalEdited: z.literal(true).optional(),
  articleTypeIds: z.array(articleTypeId).optional(),
});
export type BankJournal = z.infer<typeof journal>;
export type BankArticleType = z.infer<typeof articleType>;
export type BankJournalPage = z.infer<typeof BankJournalPageSchema>;
