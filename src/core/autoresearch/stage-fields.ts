import { z } from 'zod';
import { PaperModelSentenceSchema } from '../schemas/paperModel';

export const text = z.string().trim().min(1);
export const texts = z.array(text);
export const refs = texts.min(1);
export const evidenceScope = z.enum(['abstract', 'full_text']);

export const literatureProvider = z.enum(['lab_kg', 'openalex', 'corpus']);
export type LiteratureProvider = z.infer<typeof literatureProvider>;
export const sourceRecordSchema = z.strictObject({
  provider: literatureProvider,
  sourceId: text,
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime(),
});
export const collectionMetaSchema = z.strictObject({
  sources: z.array(
    z.strictObject({
      provider: literatureProvider,
      status: z.enum(['retrieved', 'empty', 'not_configured', 'unavailable']),
      errors: z.array(z.strictObject({ queryId: text.nullable(), message: text })),
    }),
  ),
});

const sentenceKey = PaperModelSentenceSchema.shape.key;
const cardFieldsSchema = z.strictObject({
  id: text,
  decisionId: text,
  problem: text.nullable(),
  method: text.nullable(),
  data: text.nullable(),
  metrics: text.nullable(),
  findings: text.nullable(),
  limitations: text.nullable(),
  evidence_scope: evidenceScope,
});
export const cardOutputSchema = cardFieldsSchema.extend({ quote_anchors: z.array(sentenceKey) });
export const cardSchema = cardFieldsSchema.extend({
  quote_anchors: cardOutputSchema.shape.quote_anchors.optional(),
  full_text_source: z
    .strictObject({
      paperId: text,
      sentences: z
        .array(
          z.strictObject({
            key: sentenceKey,
            section: text,
            page: z.number().int().positive().nullable(),
            text,
          }),
        )
        .min(1),
    })
    .optional(),
});
