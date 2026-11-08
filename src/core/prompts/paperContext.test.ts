import { expect, it } from 'vitest';
import { analyzeText } from '../text/analyzeText';
import {
  buildSentenceSyntaxPrompt,
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
