import { applyJudgement } from '@/core/detectors';
import {
  buildCandidateJudgePrompt,
  CandidateJudgeOutputSchema,
  PROMPT_VERSIONS,
  type CandidateJudgeOutput,
} from '@/core/prompts';
import type { Analysis, Issue, SentenceAnnotation, TextAnalysis } from '@/core/schemas';
import type { LlmClient } from './client';

export function createLlmCandidateJudge(client: LlmClient) {
  return {
    async judge(
      text: TextAnalysis,
      annotations: SentenceAnnotation[] | null,
      candidates: Issue[],
      context: Analysis['context'],
      signal?: AbortSignal,
    ) {
      const output: CandidateJudgeOutput = { judgements: [], passive: [] };
      let model: string | null = null;
      const count = Math.max(
        Math.ceil(candidates.length / 40),
        annotations?.some((a) => a.voice === 'passive') ? 1 : 0,
      );
      for (let i = 0; i < count; i++) {
        const batch = candidates.slice(i * 40, (i + 1) * 40);
        const prompt = buildCandidateJudgePrompt(text, annotations, batch, context, i === 0);
        const { data, meta } = await client.completeJson({
          ...prompt,
          schema: CandidateJudgeOutputSchema,
          schemaName: 'candidate_judgement',
          promptVersion: PROMPT_VERSIONS.candidateJudge,
          temperature: 0,
          signal,
        });
        output.judgements.push(
          ...data.judgements.filter((entry) => batch.some((candidate) => candidate.id === entry.id)),
        );
        if (i === 0) output.passive.push(...data.passive);
        model = meta.model;
      }
      return {
        issues: applyJudgement(candidates, output, text, annotations),
        model,
        promptVersion: PROMPT_VERSIONS.candidateJudge,
      };
    },
  };
}
