import { buildArgumentRun, planArguments } from '@/core/argument';
import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { buildArgumentPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import { ArgumentOutputSchema, type ArgumentPending, type Paper } from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { ConsentRequiredError } from './errors';

const TIMEOUT_MS = 240000;
const fatal = (cause: unknown) =>
  cause instanceof BatchBudgetExceededError ||
  cause instanceof ConsentRequiredError ||
  (cause instanceof DOMException && cause.name === 'AbortError');

export async function llmArgument(
  client: LlmClient,
  paper: Paper,
  options: {
    sectionIds: string[];
    config: LlmConfig;
    budget: number;
    pending?: ArgumentPending | null;
    onRequest: (callsUsed: number) => void;
    onProgress: (pending: ArgumentPending) => Promise<void>;
    signal?: AbortSignal;
    newId?: () => string;
    now?: () => string;
  },
) {
  requirePaperConsent(options.config);
  const chunks = planArguments(paper, options.sectionIds);
  if (!chunks.length) throw new Error('Không có đoạn nào để phân tích.');
  const state: ArgumentPending = options.pending ?? {
    sectionIds: options.sectionIds,
    callsUsed: 0,
    model: null,
    chunks: {},
  };
  let incomplete = false;
  for (const chunk of chunks) {
    if (state.chunks[chunk.id]) continue;
    try {
      const result = await client.completeJson({
        ...buildArgumentPrompt(chunk.paragraphs),
        schema: ArgumentOutputSchema,
        schemaName: 'arguments',
        promptVersion: PROMPT_VERSIONS.argument,
        temperature: 0.1,
        timeoutMs: TIMEOUT_MS,
        signal: options.signal,
        onRequest: async () => {
          requirePaperConsent(options.config);
          if (state.callsUsed >= options.budget) throw new BatchBudgetExceededError();
          state.callsUsed++;
          options.onRequest(state.callsUsed);
          await options.onProgress(state);
        },
      });
      state.chunks[chunk.id] = ArgumentOutputSchema.parse(result.data);
      state.model = result.meta.model;
      await options.onProgress(state);
    } catch (cause) {
      if (fatal(cause)) throw cause;
      incomplete = true;
    }
  }
  const run = buildArgumentRun({
    id: options.newId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: state.model ?? options.config.model,
    promptVersion: PROMPT_VERSIONS.argument,
    callsUsed: state.callsUsed,
    sectionIds: options.sectionIds,
    chunks,
    results: state.chunks,
  });
  return { run, state, incomplete };
}
