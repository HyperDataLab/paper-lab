import { z } from 'zod';
import type { Sentence, TextAnalysis } from '../schemas/text';

const index = z.number().int().nonnegative();
const range = z.object({ start: index, end: index }).nullable();

/** What the model may return: token indexes only. Offsets are computed by code (AGENTS.md invariant 1). */
export const SentenceSyntaxOutputSchema = z.object({
  sentences: z.array(
    z.object({
      sentenceId: z.string(),
      subject: range,
      subjectHead: index.nullable(),
      mainVerb: range,
      mainVerbHead: index.nullable(),
      topic: range,
      action: range,
      stress: range,
      voice: z.enum(['active', 'passive']).nullable(),
      clauseCount: index.nullable(),
      maxClauseDepth: index.nullable(),
      confidence: z.number().nullable(),
    }),
  ),
});
export type SentenceSyntaxOutput = z.infer<typeof SentenceSyntaxOutputSchema>;
export type RawSentenceSyntax = SentenceSyntaxOutput['sentences'][number];

export const SENTENCE_SYNTAX_SYSTEM = [
  'You annotate English scientific sentences for a writing-analysis tool based on Joshua Schimel, Writing Science.',
  'Each sentence is given as numbered tokens, e.g. "s1: [0]The [1]performance ...". The numbers are global token indexes.',
  'For every sentence return token index ranges {start, end} with end exclusive, and single token indexes for heads:',
  '- subject: the main-clause grammatical subject phrase; subjectHead: its head noun.',
  '- mainVerb: the main-clause verb group, from the first finite verb or auxiliary to the lexical verb, including adverbs inside the group (e.g. "was dramatically improved"); mainVerbHead: the lexical verb.',
  '- topic: what the sentence is about (usually the subject, near the start).',
  '- action: what the topic does (the main predicate).',
  '- stress: the new or most important information, usually at the end of the sentence.',
  '- voice: "active" or "passive" for the main clause.',
  '- clauseCount: number of finite clauses; maxClauseDepth: deepest subordinate nesting (0 = no subordinate clause).',
  '- confidence: your confidence from 0 to 1 for this sentence.',
  'Rules: return token indexes only, never character offsets. Never rewrite, correct or quote the text.',
  'Use null for anything you are unsure about. Do not judge quality; passive voice is not an error.',
].join('\n');

export function formatNumberedSentences(text: TextAnalysis, sentences: Sentence[] = text.sentences): string {
  return sentences
    .map((sentence) => {
      const tokens = text.tokens
        .slice(sentence.tokenStart, sentence.tokenEnd)
        .map((token) => `[${token.index}]${token.text}`)
        .join(' ');
      return `${sentence.id}: ${tokens}`;
    })
    .join('\n');
}

export function buildSentenceSyntaxPrompt(
  text: TextAnalysis,
  sentences: Sentence[] = text.sentences,
): { system: string; user: string } {
  return {
    system: SENTENCE_SYNTAX_SYSTEM,
    user: `Annotate these sentences. Return one entry per sentence id.\n\n${formatNumberedSentences(text, sentences)}`,
  };
}
