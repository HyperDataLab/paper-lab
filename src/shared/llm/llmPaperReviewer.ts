import {
  buildPaperReviewPrompt,
  planPaperReview,
  PaperReviewOutputSchema,
  PROMPT_VERSIONS,
  type Lens,
} from '@/core/prompts';
import { anchorReview } from '@/core/reviewPanel';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';

export async function llmPaperReviewer(
  client: LlmClient,
  paper: Paper,
  options: {
    lenses: Lens[];
    sectionIds: string[];
    checkSummary: string;
    config: LlmConfig;
    budget: number;
    callsUsed?: number;
    onRequest: (callsUsed: number) => Promise<void>;
    signal?: AbortSignal;
  },
) {
  if (
    !Number.isSafeInteger(options.budget) ||
    options.budget < 0 ||
    !Number.isSafeInteger(options.callsUsed ?? 0) ||
    (options.callsUsed ?? 0) < 0
  )
    throw new Error('Invalid review budget');
  requirePaperConsent(options.config);
  planPaperReview(paper, options.sectionIds, options.lenses);
  const prompts = options.lenses.map((lens) =>
    buildPaperReviewPrompt(paper, {
      lens,
      sectionIds: options.sectionIds,
      checkSummary: options.checkSummary,
    }),
  );
  const reviews = [];
  let callsUsed = options.callsUsed ?? 0;
  for (const [index, lens] of options.lenses.entries()) {
    const prompt = prompts[index];
    if (!prompt) throw new Error('Review prompt missing');
    const result = await client.completeJson({
      ...prompt,
      schema: PaperReviewOutputSchema,
      schemaName: 'paper_review',
      promptVersion: PROMPT_VERSIONS.paperReview,
      temperature: 0.3,
      onRequest: async () => {
        requirePaperConsent(options.config);
        if (callsUsed >= options.budget) throw new BatchBudgetExceededError();
        callsUsed++;
        await options.onRequest(callsUsed);
      },
      signal: options.signal,
    });
    const data = PaperReviewOutputSchema.parse(result.data);
    if (data.lens !== lens) throw new Error('Review lens does not match request');
    reviews.push({ review: anchorReview(data, paper, options.sectionIds), model: result.meta.model });
  }
  return reviews;
}
