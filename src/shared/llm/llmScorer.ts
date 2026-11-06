import type { Analysis } from '@/core/schemas';
import { buildScoringPrompt, PROMPT_VERSIONS, ScoringOutputSchema } from '@/core/prompts';
import { assessability } from '@/core/scoring/availability';
import { buildEvidencePackages } from '@/core/scoring/evidencePackage';
import { computeScores } from '@/core/scoring/computeScores';
import { DIMENSIONS } from '@/core/scoring/rubric';
import type { LlmClient } from './client';

export function createLlmScorer(client: LlmClient) {
  return {
    async score(analysis: Analysis, signal?: AbortSignal) {
      const availability = assessability(analysis);
      const packages = buildEvidencePackages(analysis, availability);
      const prompt = buildScoringPrompt(
        analysis.text,
        packages,
        DIMENSIONS.filter((item) => availability[item.id].applicable),
        analysis.context,
      );
      const { data, meta } = await client.completeJson({
        ...prompt,
        schema: ScoringOutputSchema,
        schemaName: 'scoring',
        promptVersion: PROMPT_VERSIONS.scoring,
        temperature: 0,
        signal,
      });
      return {
        scores: computeScores(data, availability, analysis.issues, {
          sentenceIds: analysis.text.sentences.map((item) => item.id),
          contextLimited: analysis.contextLimited,
        }),
        model: meta.model,
        promptVersion: PROMPT_VERSIONS.scoring,
      };
    },
  };
}
