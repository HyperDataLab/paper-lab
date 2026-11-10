import { z } from 'zod';

export const RetractedWorkSchema = z.object({
  doi: z.string(),
  title: z.string().nullable(),
  year: z.number().int().nullable(),
  /** True when the retracted work is the paper itself rather than something it cites. */
  isPaper: z.boolean(),
});
export const PaperContextRecordSchema = z.object({
  schemaVersion: z.literal(1),
  paperId: z.uuid(),
  checkedAt: z.iso.datetime(),
  paperDoi: z.string().nullable(),
  /** DOIs sent to OpenAlex. */
  checked: z.number().int().nonnegative(),
  /** DOIs OpenAlex has a record for; the rest could not be assessed. */
  found: z.number().int().nonnegative(),
  retracted: z.array(RetractedWorkSchema),
});
export type RetractedWork = z.infer<typeof RetractedWorkSchema>;
export type PaperContextRecord = z.infer<typeof PaperContextRecordSchema>;
