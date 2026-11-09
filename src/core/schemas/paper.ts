import { z } from 'zod';

export const SectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  role: z.enum([
    'title',
    'abstract',
    'introduction',
    'methods',
    'results',
    'discussion',
    'conclusion',
    'related_work',
    'references',
    'appendix',
    'other',
  ]),
  level: z.number().int().positive(),
  pageStart: z.number().int().positive().nullable(),
});
export const PaperTableSchema = z.object({
  /** Paragraph id of the adjacent `Table N` caption, when one exists. */
  captionId: z.string().nullable(),
  /** `column` is null when the reader could not align the cell; a cell is never guessed into a column. */
  rows: z.array(
    z.object({
      cells: z.array(z.object({ text: z.string(), column: z.number().int().nonnegative().nullable() })),
    }),
  ),
  columns: z.number().int().positive(),
  confidence: z.enum(['high', 'low']),
});
export const PaperParagraphSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  order: z.number().int().nonnegative(),
  text: z.string(),
  pageStart: z.number().int().positive().nullable(),
  kind: z.enum(['body', 'caption', 'equation', 'list', 'reference', 'heading_like', 'footnote', 'table']),
  textHash: z.string(),
  table: PaperTableSchema.optional(),
  equationLabel: z.string().nullable().optional(),
});
export const PaperSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  source: z.object({
    kind: z.enum(['pdf', 'latex', 'markdown', 'text']),
    fileName: z.string(),
    pageCount: z.number().int().positive().nullable(),
    sha256: z.string(),
    parserVersion: z.string().nullable().optional(),
  }),
  sections: z.array(SectionSchema),
  paragraphs: z.array(PaperParagraphSchema),
});
export type Paper = z.infer<typeof PaperSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type PaperParagraph = z.infer<typeof PaperParagraphSchema>;
export type PaperTable = z.infer<typeof PaperTableSchema>;
