import { z } from 'zod';

export const AuditRecordSchema = z.object({
  doi: z.string(),
  title: z.string().optional(),
  container_title: z.string().optional(),
  authors: z.array(z.string()).max(5),
  author_count: z.number().int().nonnegative(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  issued_year: z.number().int().optional(),
  published_online_year: z.number().int().optional(),
  published_print_year: z.number().int().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
});
export const AuditItemSchema = z.object({
  index: z.number().int().nonnegative(),
  textHash: z.string(),
  verdict: z.enum(['matched', 'mismatch', 'not_registered', 'unresolved', 'error']),
  lookup: z.enum(['doi', 'bibliographic']).nullable(),
  record: AuditRecordSchema.optional(),
  mismatches: z.array(
    z.object({
      field: z.enum(['year', 'title', 'first_author', 'journal', 'volume', 'pages']),
      stated: z.string().optional(),
      record: z.string().optional(),
    }),
  ),
  notes: z.array(z.string()),
});
export const ReferenceAuditSchema = z.object({
  schemaVersion: z.literal(1),
  auditedAt: z.iso.datetime(),
  items: z.array(AuditItemSchema).max(400),
  reviewed: z.array(z.string()),
});
export type ReferenceAudit = z.infer<typeof ReferenceAuditSchema>;
export type AuditItem = z.infer<typeof AuditItemSchema>;
