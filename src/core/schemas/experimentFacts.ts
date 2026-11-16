import { z } from 'zod';

const TableCellSchema = z.object({
  blockId: z.string(),
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  rowHeader: z.string().nullable(),
  columnHeader: z.string().nullable(),
});
const FactBase = z.object({
  id: z.string(),
  kind: z.enum(['task', 'design', 'sample', 'dataset', 'baseline', 'method', 'metric', 'result']),
  value: z.string(),
  number: z.number().nullable(),
  unit: z.string().nullable(),
  uncertainty: z.string().nullable(),
  condition: z.string().nullable(),
  metric: z.string().nullable(),
  dataset: z.string().nullable(),
  system: z.string().nullable(),
  sentenceKeys: z.array(z.string()),
  tableCell: TableCellSchema.nullable(),
  status: z.enum(['candidate', 'accepted']),
});
export const ExperimentFactSchema = z.union([
  FactBase.extend({ sentenceKeys: z.array(z.string()).min(1) }),
  FactBase.extend({ tableCell: TableCellSchema }),
]);
export const ExperimentFactsSchema = z.object({
  format: z.literal('paperlab-experiment-facts'),
  schemaVersion: z.literal(1),
  /** The published id: `sha256-<hex>` of the PDF when recorded, else PaperLab's local paper UUID. */
  paperId: z
    .string()
    .regex(/^(sha256-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u),
  modelEtag: z.string().regex(/^[0-9a-f]{64}$/iu),
  generatedAt: z.iso.datetime(),
  run: z.object({ id: z.uuid(), promptVersion: z.string(), model: z.string(), at: z.iso.datetime() }),
  facts: z.array(ExperimentFactSchema),
});
export type ExperimentFact = z.infer<typeof ExperimentFactSchema>;
export type ExperimentFacts = z.infer<typeof ExperimentFactsSchema>;
