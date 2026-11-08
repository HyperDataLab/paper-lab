import { buildPaperReviewPrompt, PaperReviewOutputSchema, PROMPT_VERSIONS, type Lens } from '@/core/prompts';
import { anchorReview } from '@/core/reviewPanel';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from './client';

export async function llmPaperReviewer(
  client: LlmClient,
  paper: Paper,
  options: {
    lenses: Lens[];
    sectionIds: string[];
    checkSummary: string;
    onRequest: () => Promise<void>;
    signal?: AbortSignal;
  },
) {
  const reviews = [];
  for (const lens of options.lenses) {
    const result = await client.completeJson({
      ...buildPaperReviewPrompt(paper, {
        lens,
        sectionIds: options.sectionIds,
        checkSummary: options.checkSummary,
      }),
      schema: PaperReviewOutputSchema,
      schemaName: 'paper_review',
      promptVersion: PROMPT_VERSIONS.paperReview,
      temperature: 0.3,
      onRequest: options.onRequest,
      signal: options.signal,
    });
    if (result.data.lens !== lens) throw new Error('Review lens does not match request');
    reviews.push({ review: anchorReview(result.data, paper, options.sectionIds), model: result.meta.model });
  }
  return reviews;
}
