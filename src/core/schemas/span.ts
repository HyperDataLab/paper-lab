import { z } from 'zod';
const bounds = { start: z.number().int().nonnegative(), end: z.number().int().nonnegative() };
export const SpanSchema = z.object(bounds).refine((span) => span.end > span.start);
export const RoleSpanSchema = z
  .object({ ...bounds, role: z.string(), sentenceId: z.string().optional() })
  .refine((span) => span.end > span.start);
export type Span = z.infer<typeof SpanSchema>;
