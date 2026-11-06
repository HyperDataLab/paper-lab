import type { Analysis, SentenceAnnotation, TextAnalysis } from '@/core/schemas';
import {
  buildParagraphStructurePrompt,
  ParagraphStructureOutputSchema,
  PROMPT_VERSIONS,
} from '@/core/prompts';
import { validateParagraphStructure } from '@/core/paragraph/validateParagraphStructure';
import { computeParagraphMetrics } from '@/core/paragraph/metrics';
import { paragraphIssues } from '@/core/paragraph/issues';
import type { LlmClient } from './client';

export class MissingSentenceAnnotationsError extends Error {
  constructor() {
    super('Sentence annotations are required');
  }
}
export function createLlmParagraphAnalyzer(client: LlmClient) {
  return {
    async analyze(
      text: TextAnalysis,
      annotations: SentenceAnnotation[] | null,
      context: Analysis['context'],
      signal?: AbortSignal,
    ) {
      if (
        !annotations ||
        text.sentences.some(
          (sentence) => !annotations.some((annotation) => annotation.sentenceId === sentence.id),
        )
      )
        throw new MissingSentenceAnnotationsError();
      const prompt = buildParagraphStructurePrompt(text, annotations, context);
      const { data, meta } = await client.completeJson({
        ...prompt,
        schema: ParagraphStructureOutputSchema,
        schemaName: 'paragraph_structure',
        promptVersion: PROMPT_VERSIONS.paragraphStructure,
        temperature: 0,
        signal,
      });
      const result = validateParagraphStructure(data, text, annotations);
      return {
        ...result,
        metrics: computeParagraphMetrics(result.paragraph, result.roles, result.flowLinks),
        issues: paragraphIssues(result.paragraph, result.flowLinks, text, result.roles),
        model: meta.model,
        promptVersion: PROMPT_VERSIONS.paragraphStructure,
      };
    },
  };
}
