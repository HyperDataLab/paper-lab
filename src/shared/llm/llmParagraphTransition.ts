import { buildParagraphTransitionPrompt, PROMPT_VERSIONS, TransitionOutputSchema } from '@/core/prompts';
import { transitionFindings, validateTransitions } from '@/core/paperOverview';
import type { TransitionFinding, TransitionPair } from '@/core/schemas/paperOverview';
import type { LlmClient } from './client';

export function createLlmParagraphTransition(client: LlmClient) {
  return {
    async analyze(
      pairs: TransitionPair[],
      previous: TransitionFinding[] = [],
      signal?: AbortSignal,
      onRequest?: () => Promise<void>,
    ) {
      const prompt = buildParagraphTransitionPrompt(pairs);
      const { data, meta } = await client.completeJson({
        ...prompt,
        schema: TransitionOutputSchema,
        schemaName: 'paragraph_transition',
        promptVersion: PROMPT_VERSIONS.paragraphTransition,
        temperature: 0,
        signal,
        onRequest,
      });
      const judgements = validateTransitions(data, pairs);
      return {
        pairs,
        judgements,
        findings: transitionFindings(pairs, judgements, previous),
        model: meta.model,
        promptVersion: PROMPT_VERSIONS.paragraphTransition,
      };
    },
  };
}
