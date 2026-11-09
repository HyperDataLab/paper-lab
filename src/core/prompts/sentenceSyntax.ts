import { z } from 'zod';
import type { Sentence, TextAnalysis } from '../schemas/text';
import type { PaperContext } from './paperContext';

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
  paperContext?: PaperContext,
): { system: string; user: string } {
  return {
    system: SENTENCE_SYNTAX_SYSTEM,
    user: `${paperContext ? `Section heading: ${paperContext.heading}\n` : ''}Annotate these sentences. Return one entry per sentence id.\n\n${formatNumberedSentences(text, sentences)}`,
  };
}

/** The most sentences one request may carry; PRD P2 and docs/plans/AI-REVIEW.md. */
export const SYNTAX_BATCH_SENTENCES = 40;

/** One paragraph, or a slice of one, inside a syntax request. */
export type SyntaxBatchPart = { text: TextAnalysis; sentences?: Sentence[] };

const offsetsOf = (parts: SyntaxBatchPart[]) => {
  let total = 0;
  return parts.map((part) => {
    const offset = total;
    total += part.text.tokens.length;
    return offset;
  });
};

/**
 * Several paragraphs of one section in a single request. Sentence ids and token numbers restart in every
 * paragraph, so they are made unique for the model here and restored by splitSyntaxBatch.
 */
export function buildSyntaxBatchPrompt(
  parts: SyntaxBatchPart[],
  paperContext: PaperContext,
): { system: string; user: string } {
  const [only] = parts;
  if (only && parts.length === 1) return buildSentenceSyntaxPrompt(only.text, only.sentences, paperContext);
  const offsets = offsetsOf(parts);
  const lines = parts.flatMap((part, position) =>
    (part.sentences ?? part.text.sentences).map((sentence) => {
      const offset = offsets[position] ?? 0;
      const tokens = part.text.tokens
        .slice(sentence.tokenStart, sentence.tokenEnd)
        .map((token) => `[${token.index + offset}]${token.text}`)
        .join(' ');
      return `P${position + 1}.${sentence.id}: ${tokens}`;
    }),
  );
  return {
    system: SENTENCE_SYNTAX_SYSTEM,
    user: `Section heading: ${paperContext.heading}\nAnnotate these sentences. Return one entry per sentence id, keeping each id exactly as written.\n\n${lines.join('\n')}`,
  };
}

/** Sends each model entry back to its paragraph with that paragraph's own ids and token numbers. */
export function splitSyntaxBatch(raw: RawSentenceSyntax[], parts: SyntaxBatchPart[]): RawSentenceSyntax[][] {
  if (parts.length === 1) return [raw];
  const offsets = offsetsOf(parts);
  const result = parts.map((): RawSentenceSyntax[] => []);
  for (const entry of raw) {
    const match = /^P(\d+)\.(.+)$/u.exec(entry.sentenceId);
    const position = Number(match?.[1]) - 1;
    const bucket = result[position];
    if (!match?.[2] || !bucket) continue;
    const offset = offsets[position] ?? 0;
    const range = (value: RawSentenceSyntax['subject']) =>
      value && { start: value.start - offset, end: value.end - offset };
    const head = (value: number | null) => (value === null ? null : value - offset);
    bucket.push({
      ...entry,
      sentenceId: match[2],
      subject: range(entry.subject),
      subjectHead: head(entry.subjectHead),
      mainVerb: range(entry.mainVerb),
      mainVerbHead: head(entry.mainVerbHead),
      topic: range(entry.topic),
      action: range(entry.action),
      stress: range(entry.stress),
    });
  }
  return result;
}
