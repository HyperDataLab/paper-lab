import { z } from 'zod';

/** One token as the spaCy service returns it. `i`/`head` index the sentence's own token list. */
export const ParsedTokenSchema = z.object({
  i: z.number().int().nonnegative(),
  text: z.string(),
  /** Code points relative to the sentence text that was sent. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  lemma: z.string(),
  pos: z.string(),
  tag: z.string(),
  dep: z.string(),
  head: z.number().int().nonnegative(),
  morph: z.string(),
});
export const TenseSchema = z.enum(['past', 'present', 'future', 'none']);
export const ParsedSentenceSchema = z.object({
  key: z.string(),
  tokens: z.array(ParsedTokenSchema),
  root: z.number().int().nonnegative().nullable(),
  /** Main clause only; null for a verbless fragment. */
  voice: z.enum(['active', 'passive']).nullable(),
  /** Main finite verb: will/shall → future; other modals → none (see `modal`). */
  tense: TenseSchema,
  modal: z.string().nullable(),
});
export const ParseResultSchema = z.object({
  model: z.string(),
  modelVersion: z.string().nullable(),
  spacyVersion: z.string(),
  /** Version of the service's voice/tense rules (`SERVICE_VERSION` in topics-worker/nlp/syntax.py). */
  version: z.string(),
  sentences: z.array(ParsedSentenceSchema),
});
export type ParsedToken = z.infer<typeof ParsedTokenSchema>;
export type ParsedSentence = z.infer<typeof ParsedSentenceSchema>;
export type ParseResult = z.infer<typeof ParseResultSchema>;
export type Tense = z.infer<typeof TenseSchema>;
