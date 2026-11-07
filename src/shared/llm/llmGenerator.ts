import {
  buildGenerationPrompt,
  GenerationOutputSchema,
  PROMPT_VERSIONS,
  type GenerationInput,
} from '@/core/prompts';
import type { LlmClient } from './client';
export function createLlmGenerator(client: LlmClient) {
  return {
    async generate(input: GenerationInput, signal?: AbortSignal) {
      const { data, meta } = await client.completeJson({
        ...buildGenerationPrompt(input),
        schema: GenerationOutputSchema,
        schemaName: 'generation',
        promptVersion: PROMPT_VERSIONS.generation,
        temperature: 0,
        signal,
      });
      return { output: data, model: meta.model, promptVersion: PROMPT_VERSIONS.generation };
    },
  };
}
