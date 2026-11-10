import {
  applySuggestions,
  planFromOutput,
  SCREENING_BATCH,
  synthesisInput,
  verifySynthesis,
} from '@/core/extraction';
import { buildPlanPrompt, buildScreeningPrompt, buildSynthesisPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import {
  PlanOutputSchema,
  ScreeningOutputSchema,
  SynthesisOutputSchema,
  type Candidate,
  type ExtractionProject,
  type SearchPlan,
  type Synthesis,
} from '@/core/schemas';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';

const TIMEOUT_MS = 180000;
type Options = { config: LlmConfig; signal?: AbortSignal; onRequest?: () => void };

async function ask(
  client: LlmClient,
  options: Options,
  request: Omit<Parameters<LlmClient['completeJson']>[0], 'temperature'>,
) {
  requirePaperConsent(options.config);
  const result = await client.completeJson({
    ...request,
    temperature: 0.1,
    timeoutMs: TIMEOUT_MS,
    signal: options.signal,
    onRequest: async () => {
      requirePaperConsent(options.config);
      options.onRequest?.();
    },
  });
  return result;
}

/** One request: the research question in, a plan the user edits and approves before any search. */
export async function llmSearchPlan(
  client: LlmClient,
  question: string,
  options: Options,
): Promise<SearchPlan> {
  const result = await ask(client, options, {
    ...buildPlanPrompt(question),
    schema: PlanOutputSchema,
    schemaName: 'search_plan',
    promptVersion: PROMPT_VERSIONS.searchPlan,
  });
  return planFromOutput(PlanOutputSchema.parse(result.data));
}

/** Suggestions only, for candidates no one has decided; a person makes every screening decision. */
export async function llmScreening(
  client: LlmClient,
  question: string,
  plan: SearchPlan,
  candidates: Candidate[],
  options: Options,
) {
  let next = candidates;
  const pending = candidates.filter((candidate) => candidate.status === 'candidate' && !candidate.suggestion);
  for (let start = 0; start < pending.length; start += SCREENING_BATCH) {
    const batch = pending.slice(start, start + SCREENING_BATCH);
    const result = await ask(client, options, {
      ...buildScreeningPrompt(plan, question, batch),
      schema: ScreeningOutputSchema,
      schemaName: 'screening',
      promptVersion: PROMPT_VERSIONS.screening,
    });
    next = applySuggestions(next, ScreeningOutputSchema.parse(result.data));
  }
  return next;
}

export async function llmSynthesis(
  client: LlmClient,
  project: ExtractionProject,
  options: Options & { newId?: () => string; now?: () => string },
): Promise<Synthesis> {
  const rows = synthesisInput(project);
  if (rows.length < 2) throw new Error('Cần ít nhất 2 bài có giá trị trong ma trận để tổng hợp.');
  const result = await ask(client, options, {
    ...buildSynthesisPrompt(project.researchQuestion, rows),
    schema: SynthesisOutputSchema,
    schemaName: 'synthesis',
    promptVersion: PROMPT_VERSIONS.synthesis,
  });
  const { claims, dropped } = verifySynthesis(SynthesisOutputSchema.parse(result.data), project);
  const cited = [...new Set(claims.flatMap((claim) => claim.paperKeys))];
  return {
    id: options.newId?.() ?? crypto.randomUUID(),
    createdAt: options.now?.() ?? new Date().toISOString(),
    model: result.meta.model,
    promptVersion: PROMPT_VERSIONS.synthesis,
    paperKeys: cited,
    claims,
    droppedRefs: dropped,
  };
}
