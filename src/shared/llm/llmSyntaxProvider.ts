import { validateSyntaxOutput, type SyntaxProvider, type SyntaxResult } from '@/core/analysis';
import {
  buildSentenceSyntaxPrompt,
  PROMPT_VERSIONS,
  SentenceSyntaxOutputSchema,
  type RawSentenceSyntax,
} from '@/core/prompts';
import type { TextAnalysis } from '@/core/schemas';
import type { LlmClient } from './client';

export const SYNTAX_BATCH_SIZE = 12;
export const LLM_SYNTAX_PROVIDER_ID = `llm/${PROMPT_VERSIONS.sentenceSyntax}`;

/** ADR-0004 default provider: the model returns token indexes; validation and metrics stay in core. */
export function createLlmSyntaxProvider(client: LlmClient): SyntaxProvider {
  return {
    async analyze(text: TextAnalysis, signal?: AbortSignal): Promise<SyntaxResult> {
      const raw: RawSentenceSyntax[] = [];
      let model: string | null = null;
      for (let i = 0; i < text.sentences.length; i += SYNTAX_BATCH_SIZE) {
        const batch = text.sentences.slice(i, i + SYNTAX_BATCH_SIZE);
        const prompt = buildSentenceSyntaxPrompt(text, batch);
        const { data, meta } = await client.completeJson({
          ...prompt,
          schema: SentenceSyntaxOutputSchema,
          schemaName: 'sentence_syntax',
          promptVersion: PROMPT_VERSIONS.sentenceSyntax,
          temperature: 0,
          signal,
        });
        raw.push(...data.sentences);
        model = meta.model;
      }
      return {
        provider: 'llm',
        providerVersion: PROMPT_VERSIONS.sentenceSyntax,
        reproducible: false,
        model,
        sentences: validateSyntaxOutput(raw, text),
      };
    },
  };
}
