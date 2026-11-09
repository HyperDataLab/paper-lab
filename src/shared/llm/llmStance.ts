import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { buildStancePrompt, PROMPT_VERSIONS } from '@/core/prompts';
import { StanceOutputSchema, type Paper, type StancePending } from '@/core/schemas';
import { buildStanceRun, planStance } from '@/core/stance';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { ConsentRequiredError } from './errors';

const TIMEOUT_MS = 180000;
const fatal = (cause: unknown) =>
  cause instanceof BatchBudgetExceededError ||
  cause instanceof ConsentRequiredError ||
  (cause instanceof DOMException && cause.name === 'AbortError');

export async function llmStance(
  client: LlmClient,
  paper: Paper,
  options: {
    sectionIds: string[];
    config: LlmConfig;
    budget: number;
    pending?: StancePending | null;
    onRequest: (callsUsed: number) => void;
    onProgress: (pending: StancePending) => Promise<void>;
    onChunk?: (done: number, total: number) => void;
    signal?: AbortSignal;
    newId?: () => string;
    now?: () => string;
  },
) {
  requirePaperConsent(options.config);
  const chunks = planStance(paper, options.sectionIds);
  if (!chunks.length) throw new Error('Không có đoạn nào để phân tích.');
  const state: StancePending = options.pending ?? {
    sectionIds: options.sectionIds,
    callsUsed: 0,
    model: null,
    chunks: {},
  };
  const onRequest = async () => {
    requirePaperConsent(options.config);
    if (state.callsUsed >= options.budget) throw new BatchBudgetExceededError();
    state.callsUsed++;
    options.onRequest(state.callsUsed);
    // Saved before the request leaves, so a failed or cancelled call still counts on resume.
    await options.onProgress(state);
  };
  const failed = new Set<string>();
  const analyse = async (chunk: (typeof chunks)[number]) => {
    try {
      const result = await client.completeJson({
        ...buildStancePrompt(chunk),
        schema: StanceOutputSchema,
        schemaName: 'stance_engagement',
        promptVersion: PROMPT_VERSIONS.stanceEngagement,
        temperature: 0.1,
        timeoutMs: TIMEOUT_MS,
        onRequest,
        signal: options.signal,
      });
      state.chunks[chunk.id] = StanceOutputSchema.parse(result.data);
      state.model = result.meta.model;
      failed.delete(chunk.id);
      await options.onProgress(state);
    } catch (cause) {
      if (fatal(cause)) throw cause;
      failed.add(chunk.id);
    }
  };
  for (const [index, chunk] of chunks.entries()) {
    if (!state.chunks[chunk.id]) await analyse(chunk);
    options.onChunk?.(index + 1, chunks.length);
  }
  for (const chunk of chunks) if (failed.has(chunk.id)) await analyse(chunk);
  const run = buildStanceRun({
    id: options.newId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: state.model ?? options.config.model,
    promptVersion: PROMPT_VERSIONS.stanceEngagement,
    callsUsed: state.callsUsed,
    sectionIds: options.sectionIds,
    chunks,
    results: state.chunks,
  });
  return { run, state, incomplete: failed.size > 0 };
}
