import { z } from 'zod';
import type { Analysis, Issue, SentenceAnnotation, TextAnalysis } from '../schemas';
import { sliceCp } from '../text/offsets';

const confidence = z.number().min(0).max(1);
export const CandidateJudgeOutputSchema = z.object({
  judgements: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(['problematic', 'acceptable', 'uncertain']),
      severity: z.enum(['minor', 'moderate', 'major']).nullable(),
      confidence,
      why: z.string(),
      suggestedFix: z.string().nullable(),
    }),
  ),
  passive: z.array(
    z.object({
      sentenceId: z.string(),
      problematic: z.boolean(),
      confidence,
      why: z.string(),
      suggestedFix: z.string().nullable(),
    }),
  ),
});
export type CandidateJudgeOutput = z.infer<typeof CandidateJudgeOutputSchema>;
export function buildCandidateJudgePrompt(
  text: TextAnalysis,
  annotations: SentenceAnnotation[] | null,
  candidates: Issue[],
  context: Analysis['context'],
  includePassive = true,
) {
  return {
    system:
      'Judge whether each supplied candidate is actually a problem in context. Passive voice, hedges, necessary qualifiers and Methods-style procedure verbs can be appropriate. Do not invent numbers, effect sizes, citations or facts. suggestedFix must preserve claims, hedging, negation and numbers. Write why in Vietnamese. Return each given id once; do not add ids. For each passive sentence requested, judge whether passive voice obscures an actor or action in a way that matters.',
    user: `Paragraph: ${text.sourceText}\nContext before: ${context.before || 'context not provided'}\nContext after: ${context.after || 'context not provided'}\nAudience: ${context.audience || 'context not provided'}\nSentences:\n${text.sentences.map((s) => `${s.id} | voice: ${includePassive ? (annotations?.find((a) => a.sentenceId === s.id)?.voice ?? 'unknown') : 'not requested'} | ${sliceCp(text.sourceText, s.start, s.end)}`).join('\n')}\nCandidates:\n${candidates.map((c) => `${c.id} | ${c.type} | ${c.sentenceIds[0]} | "${c.spans.map((s) => sliceCp(text.sourceText, s.start, s.end)).join(' / ')}" | ${c.metric.name}: ${c.metric.value ?? 'unknown'} ${c.metric.unit ?? ''}`).join('\n')}`,
  };
}
