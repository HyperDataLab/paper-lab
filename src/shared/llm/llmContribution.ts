import { contributionChunks, verifyContribution } from '@/core/contribution';
import { sectionTree, sentenceIndex } from '@/core/paperModel';
import { buildContributionPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import {
  ContributionOutputSchema,
  type ContributionPending,
  type ContributionRun,
  type Paper,
} from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

export async function llmContribution(
  client: LlmClient,
  paper: Paper,
  options: {
    config: LlmConfig;
    pending?: ContributionPending | null;
    onProgress?: (pending: ContributionPending) => Promise<void>;
  },
): Promise<ContributionRun> {
  requirePaperConsent(options.config);
  const chunks = contributionChunks(sentenceIndex(paper));
  if (!chunks.length) throw new Error('Không có câu để phân tích.');
  const keys = chunks.flat().map((sentence) => sentence.key);
  const state: ContributionPending =
    options.pending &&
    options.pending.promptVersion === PROMPT_VERSIONS.contribution &&
    options.pending.requestedModel === options.config.model &&
    JSON.stringify(options.pending.keys) === JSON.stringify(keys)
      ? options.pending
      : {
          keys,
          promptVersion: PROMPT_VERSIONS.contribution,
          requestedModel: options.config.model,
          model: options.config.model,
          callsUsed: 0,
          chunks: {},
        };
  for (const [index, chunk] of chunks.entries()) {
    if (state.chunks[String(index)]) continue;
    const result = await client.completeJson({
      ...buildContributionPrompt(chunk, sectionTree(paper)),
      schema: ContributionOutputSchema,
      schemaName: 'contribution',
      promptVersion: PROMPT_VERSIONS.contribution,
      temperature: 0,
      timeoutMs: 300000,
      onRequest: async () => {
        requirePaperConsent(options.config);
        state.callsUsed++;
        await options.onProgress?.(state);
      },
    });
    const verified = verifyContribution(ContributionOutputSchema.parse(result.data), chunk);
    state.chunks[String(index)] = verified;
    state.model = result.meta.model;
    await options.onProgress?.(state);
  }
  const results = Object.values(state.chunks);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    model: state.model,
    promptVersion: PROMPT_VERSIONS.contribution,
    callsUsed: state.callsUsed,
    domain:
      results.filter((item) => item.domain === 'other').length > results.length / 2 ? 'other' : 'ml_nlp',
    sentences: results.flatMap((item) => item.sentences),
    droppedPhrases: results.reduce((sum, item) => sum + item.droppedPhrases, 0),
    droppedTriples: results.reduce((sum, item) => sum + item.droppedTriples, 0),
  };
}
