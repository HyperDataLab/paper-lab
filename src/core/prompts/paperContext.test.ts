import { describe, expect, it } from 'vitest';
import { analyzeText } from '../text/analyzeText';
import {
  buildSentenceSyntaxPrompt,
  buildSyntaxBatchPrompt,
  splitSyntaxBatch,
  buildCandidateJudgePrompt,
  buildParagraphStructurePrompt,
  buildScoringPrompt,
  PROMPT_VERSIONS,
} from '.';

it('P2 adds section-aware prompt context without changing the default prompts', async () => {
  const text = await analyzeText('This works.');
  const paper = {
    role: 'methods' as const,
    heading: 'Methods',
    previousLast: 'Before.',
    nextFirst: 'After.',
  };
  const context = { before: null, after: null, audience: null };
  expect(buildSentenceSyntaxPrompt(text, text.sentences, paper).user).toContain('Section heading: Methods');
  expect(buildCandidateJudgePrompt(text, null, [], context, true, paper).user).toContain('were conducted');
  expect(buildParagraphStructurePrompt(text, [], context, paper).user).toContain(
    'Previous paragraph ends with: "Before."',
  );
  expect(buildScoringPrompt(text, [], [], context, paper).user).toContain('Section role: methods');
  expect(buildSentenceSyntaxPrompt(text)).toEqual(buildSentenceSyntaxPrompt(text, text.sentences, undefined));
  expect(PROMPT_VERSIONS.scoringPaper).toBe('score-paper-1');
});

describe('P2 syntax batches', () => {
  const heading = { role: 'methods' as const, heading: 'Methods', previousLast: null, nextFirst: null };
  const raw = (sentenceId: string, base: number) => ({
    sentenceId,
    subject: { start: base, end: base + 1 },
    subjectHead: base,
    mainVerb: null,
    mainVerbHead: null,
    topic: null,
    action: null,
    stress: null,
    voice: null,
    clauseCount: null,
    maxClauseDepth: null,
    confidence: null,
  });
  it('leaves a lone paragraph exactly as the single-paragraph prompt', async () => {
    const text = await analyzeText('One sentence here.');
    expect(buildSyntaxBatchPrompt([{ text }], heading)).toEqual(
      buildSentenceSyntaxPrompt(text, undefined, heading),
    );
    const entries = [raw('s1', 0)];
    expect(splitSyntaxBatch(entries, [{ text }])).toEqual([entries]);
  });
  it('makes ids and token numbers unique across paragraphs and restores them', async () => {
    const parts = [{ text: await analyzeText('Alpha works.') }, { text: await analyzeText('Beta fails.') }];
    const offset = parts[0]?.text.tokens.length ?? 0;
    const { user } = buildSyntaxBatchPrompt(parts, heading);
    expect(user).toContain('P1.s1: [0]Alpha');
    expect(user).toContain(`P2.s1: [${offset}]Beta`);
    const split = splitSyntaxBatch([raw('P2.s1', offset), raw('P9.s1', 0), raw('nonsense', 0)], parts);
    expect(split[0]).toEqual([]);
    expect(split[1]).toEqual([raw('s1', 0)]);
  });
});
