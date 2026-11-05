import { z } from 'zod';
const offset = z.number().int().nonnegative();
export const TokenSchema = z.object({
  index: offset,
  text: z.string().min(1),
  start: offset,
  end: offset,
  kind: z.enum(['word', 'number', 'punct', 'symbol', 'citation']),
});
export const SentenceSchema = z.object({
  id: z.string().regex(/^s[1-9]\d*$/),
  start: offset,
  end: offset,
  tokenStart: offset,
  tokenEnd: offset,
});
export const TextAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  sourceText: z.string(),
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  offsetUnit: z.literal('unicode_codepoint'),
  tokenizerVersion: z.literal('pl-tok-2'),
  segmenterVersion: z.literal('pl-seg-2'),
  sentences: z.array(SentenceSchema),
  tokens: z.array(TokenSchema),
});
export type Token = z.infer<typeof TokenSchema>;
export type Sentence = z.infer<typeof SentenceSchema>;
export type TextAnalysis = z.infer<typeof TextAnalysisSchema>;
