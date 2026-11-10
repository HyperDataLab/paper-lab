import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { buildAbstractAlignmentPrompt, buildRhetoricPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import { alignmentInputs, buildRhetoricRun, planRhetoric } from '@/core/rhetoric';
import {
  AbstractAlignmentOutputSchema,
  RhetoricOutputSchema,
  type Paper,
  type RhetoricPending,
} from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { ConsentRequiredError } from './errors';

const TIMEOUT_MS = 180000;
const fatal = (cause: unknown) =>
  cause instanceof BatchBudgetExceededError ||
  cause instanceof ConsentRequiredError ||
  (cause instanceof DOMException && cause.name === 'AbortError');

export function estimateRhetoric(paper: Paper, sectionIds: string[]) {
  const { abstract, body } = alignmentInputs(paper, sectionIds);
  return planRhetoric(paper, sectionIds).length + (abstract.length && body.length ? 1 : 0);
}

export async function llmRhetoric(
  client: LlmClient,
  paper: Paper,
  options: {
    sectionIds: string[];
    config: LlmConfig;
    budget: number;
    pending?: RhetoricPending | null;
    onRequest: (callsUsed: number) => void;
    onProgress: (pending: RhetoricPending) => Promise<void>;
    signal?: AbortSignal;
    newId?: () => string;
    now?: () => string;
    /** False for a run of a few sections, which keeps the whole-paper abstract comparison it has. */
    alignment?: boolean;
  },
) {
  requirePaperConsent(options.config);
  const chunks = planRhetoric(paper, options.sectionIds);
  if (!chunks.length) throw new Error('Không có đoạn nào để phân tích.');
  const state: RhetoricPending = options.pending ?? {
    sectionIds: options.sectionIds,
    callsUsed: 0,
    model: null,
    chunks: {},
    alignment: null,
  };
  const onRequest = async () => {
    requirePaperConsent(options.config);
    if (state.callsUsed >= options.budget) throw new BatchBudgetExceededError();
    state.callsUsed++;
    options.onRequest(state.callsUsed);
    await options.onProgress(state);
  };
  let incomplete = false;
  /** One failed request leaves its part unread instead of ending the run. */
  const attempt = async (call: () => Promise<void>) => {
    try {
      await call();
      await options.onProgress(state);
    } catch (cause) {
      if (fatal(cause)) throw cause;
      incomplete = true;
    }
  };
  for (const chunk of chunks) {
    if (state.chunks[chunk.id]) continue;
    await attempt(async () => {
      const result = await client.completeJson({
        ...buildRhetoricPrompt(chunk.paragraphs),
        schema: RhetoricOutputSchema,
        schemaName: 'rhetoric',
        promptVersion: PROMPT_VERSIONS.rhetoric,
        temperature: 0.1,
        timeoutMs: TIMEOUT_MS,
        onRequest,
        signal: options.signal,
      });
      state.chunks[chunk.id] = RhetoricOutputSchema.parse(result.data);
      state.model = result.meta.model;
    });
  }
  const { abstract, body } = alignmentInputs(paper, options.sectionIds);
  if (options.alignment !== false && abstract.length && body.length && !state.alignment) {
    await attempt(async () => {
      const result = await client.completeJson({
        ...buildAbstractAlignmentPrompt(abstract, body),
        schema: AbstractAlignmentOutputSchema,
        schemaName: 'abstract_alignment',
        promptVersion: PROMPT_VERSIONS.abstractAlignment,
        temperature: 0.1,
        timeoutMs: TIMEOUT_MS,
        onRequest,
        signal: options.signal,
      });
      state.alignment = AbstractAlignmentOutputSchema.parse(result.data);
      state.model = result.meta.model;
    });
  }
  const run = buildRhetoricRun({
    id: options.newId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: state.model ?? options.config.model,
    promptVersion: `${PROMPT_VERSIONS.rhetoric}+${PROMPT_VERSIONS.abstractAlignment}`,
    callsUsed: state.callsUsed,
    sectionIds: options.sectionIds,
    chunks,
    results: state.chunks,
    alignment: { output: state.alignment, abstract, body },
  });
  return { run, state, incomplete };
}
