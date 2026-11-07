import {
  buildRevisionPrompt,
  PROMPT_VERSIONS,
  RevisionOutputSchema,
  type RevisionConstraints,
} from '@/core/prompts';
import type { Analysis, Issue } from '@/core/schemas';
import type { LlmClient } from './client';

export function createLlmRevisionProvider(client: LlmClient) {
  return {
    async revise(
      analysis: Analysis,
      selectedIssues: Issue[],
      constraints: RevisionConstraints,
      signal?: AbortSignal,
    ) {
      const { data, meta } = await client.completeJson({
        ...buildRevisionPrompt(analysis, selectedIssues, constraints),
        schema: RevisionOutputSchema,
        schemaName: 'revision',
        promptVersion: PROMPT_VERSIONS.revision,
        temperature: 0,
        signal,
      });
      return { output: data, model: meta.model, promptVersion: PROMPT_VERSIONS.revision };
    },
  };
}
