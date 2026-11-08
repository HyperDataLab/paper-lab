import { z } from 'zod';
import { CONTINUITIES, RELATIONS, SENTENCE_ROLES, STRUCTURE_TYPES } from '../schemas/paragraph';
import type { SentenceAnnotation } from '../schemas/analysis';
import type { TextAnalysis } from '../schemas/text';
import { createOffsetIndex } from '../text/offsets';
import type { PaperContext } from './paperContext';

const confidence = z.number().min(0).max(1);
export const ParagraphStructureOutputSchema = z.object({
  type: z.string(),
  typeScores: z.record(z.enum(STRUCTURE_TYPES), confidence),
  centralPointSentenceId: z.string().nullable(),
  identifiability: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  evidence: z.string(),
  roles: z.array(
    z.object({ sentenceId: z.string(), role: z.enum(SENTENCE_ROLES), confidence, rationale: z.string() }),
  ),
  offTopicSentenceIds: z.array(z.string()),
  unityRationale: z.string(),
  pairs: z.array(
    z.object({
      fromSentenceId: z.string(),
      toSentenceId: z.string(),
      continuity: z.enum(CONTINUITIES),
      discourseRelation: z.enum(RELATIONS),
      linked: z.boolean(),
      confidence: confidence.nullable(),
      rationale: z.string(),
    }),
  ),
  rationale: z.string(),
});
export type ParagraphStructureOutput = z.infer<typeof ParagraphStructureOutputSchema>;

export function buildParagraphStructurePrompt(
  text: TextAnalysis,
  annotations: SentenceAnnotation[],
  context: { before: string | null; after: string | null; audience: string | null },
  paperContext?: PaperContext,
) {
  const offsets = createOffsetIndex(text.sourceText);
  const quote = (span: { start: number; end: number } | null | undefined) =>
    span ? JSON.stringify(offsets.sliceCp(span.start, span.end)) : 'null';
  const sentences = text.sentences
    .map((sentence) => {
      const annotation = annotations.find((item) => item.sentenceId === sentence.id);
      return `${sentence.id} | ${quote(sentence)} | T: ${quote(annotation?.topicSpan)} | A: ${quote(annotation?.actionSpan)} | S: ${quote(annotation?.stressSpan)} | ${annotation?.voice ?? 'unknown'}`;
    })
    .join('\n');
  return {
    system:
      'Classify the paragraph only, based on Schimel: TS-D is topic sentence plus development; LD is lead plus development; LDR adds resolution; OCAR is opening, challenge, action, resolution. Assign sentence roles and a score for each type; use UNKNOWN when no structure fits. Judge every adjacent pair: does the first stress connect to the next topic, and what discourse relation connects them? Use other only when you can name the relation in rationale; if no relation is defensible use none. Never return offsets or rewrite text. Write rationale and evidence in Vietnamese.',
    user: `${paperContext ? `Section role: ${paperContext.role}\nPrevious paragraph ends with: ${JSON.stringify(paperContext.previousLast)}\nNext paragraph starts with: ${JSON.stringify(paperContext.nextFirst)}\n` : ''}Context: ${context.before || context.after || context.audience ? JSON.stringify(context) : 'context not provided'}\n\n${sentences}`,
  };
}
