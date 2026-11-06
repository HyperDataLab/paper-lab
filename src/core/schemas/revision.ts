import { z } from 'zod';
import { SpanSchema } from './span';
import { RevisionOutputSchema } from '../prompts/revision';

const ChangeSchema = RevisionOutputSchema.shape.changes.element;
export const RevisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  sourceAnalysisId: z.uuid(),
  sourceHash: z.string(),
  revisedText: z.string(),
  revisedHash: z.string(),
  hunks: z.array(
    z.object({
      kind: z.enum(['equal', 'insert', 'delete', 'replace']),
      before: SpanSchema.nullable(),
      after: SpanSchema.nullable(),
      changeIndexes: z.array(z.number().int().nonnegative()),
      unexplained: z.boolean(),
    }),
  ),
  changes: z.array(ChangeSchema),
  unmatchedChanges: z.array(ChangeSchema),
  needsEvidence: RevisionOutputSchema.shape.needsEvidence,
  checks: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['pass', 'warn', 'fail']),
      detail: z.string(),
      spans: z.array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            side: z.enum(['source', 'revised']),
          })
          .refine((span) => span.end > span.start),
      ),
    }),
  ),
  appliedIssueIds: z.array(z.string()),
  promptVersion: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime(),
});
export type Revision = z.infer<typeof RevisionSchema>;
