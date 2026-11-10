import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import {
  cellsFromOutput,
  extractionSource,
  failedCells,
  fieldBatches,
  insufficientCells,
  mergeCells,
} from '@/core/extraction';
import { buildMatrixPrompt, PROMPT_VERSIONS } from '@/core/prompts';
import {
  MatrixOutputSchema,
  type ExtractionMode,
  type ExtractionProject,
  type ExtractionRun,
  type Paper,
} from '@/core/schemas';
import { describeLlmError } from './describeError';
import type { LlmClient } from './client';
import type { LlmConfig } from './config';
import { requirePaperConsent } from './consent';
import { ConsentRequiredError } from './errors';

const TIMEOUT_MS = 180000;
const fatal = (cause: unknown) =>
  cause instanceof BatchBudgetExceededError ||
  cause instanceof ConsentRequiredError ||
  (cause instanceof DOMException && cause.name === 'AbortError');

/**
 * Standard mode: one pass per paper and batch of fields. Every paper is saved as soon as it is done, so a stop,
 * a failure or the budget never loses finished work.
 */
export async function llmExtraction(
  client: LlmClient,
  project: ExtractionProject,
  papers: Map<string, Paper>,
  options: {
    paperKeys: string[];
    fieldKeys: string[];
    mode: ExtractionMode;
    keepVerified: boolean;
    config: LlmConfig;
    budget: number;
    save: (project: ExtractionProject) => Promise<void>;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
    newId?: () => string;
    now?: () => string;
  },
) {
  requirePaperConsent(options.config);
  const now = options.now ?? (() => new Date().toISOString());
  const run: ExtractionRun = {
    id: options.newId?.() ?? crypto.randomUUID(),
    mode: options.mode,
    createdAt: now(),
    finishedAt: null,
    status: 'RUNNING',
    model: options.config.model,
    promptVersion: PROMPT_VERSIONS.extraction,
    callsUsed: 0,
    paperKeys: options.paperKeys,
    fieldKeys: options.fieldKeys,
    errors: [],
  };
  let current: ExtractionProject = { ...project, runs: [...project.runs, run] };
  const fields = current.fields.filter((field) => options.fieldKeys.includes(field.key));
  const targets = current.papers.filter((paper) => options.paperKeys.includes(paper.key));
  const update = (patch: Partial<ExtractionRun>) => {
    Object.assign(run, patch);
    current = { ...current, runs: current.runs.map((item) => (item.id === run.id ? { ...run } : item)) };
  };
  const finish = async (status: ExtractionRun['status']) => {
    update({ status, finishedAt: now() });
    await options.save(current);
    return current;
  };
  await options.save(current);
  try {
    for (const [index, target] of targets.entries()) {
      const context = { paper: target, runId: run.id, mode: options.mode, at: now() };
      const source = extractionSource(
        target,
        target.source.kind === 'paper' ? papers.get(target.source.paperId) : undefined,
      );
      let cells = source.length ? [] : insufficientCells(fields, context);
      for (const batch of source.length ? fieldBatches(fields) : []) {
        try {
          const result = await client.completeJson({
            ...buildMatrixPrompt(source, batch, target.access),
            schema: MatrixOutputSchema,
            schemaName: 'extraction_matrix',
            promptVersion: PROMPT_VERSIONS.extraction,
            temperature: 0,
            timeoutMs: TIMEOUT_MS,
            signal: options.signal,
            onRequest: async () => {
              requirePaperConsent(options.config);
              if (run.callsUsed >= options.budget) throw new BatchBudgetExceededError();
              update({ callsUsed: run.callsUsed + 1 });
            },
          });
          update({ model: result.meta.model });
          cells = [
            ...cells,
            ...cellsFromOutput(MatrixOutputSchema.parse(result.data), batch, source, context),
          ];
        } catch (cause) {
          if (fatal(cause)) throw cause;
          const message = describeLlmError(cause) ?? 'Lỗi không xác định';
          update({ errors: [...run.errors, { paperKey: target.key, message }] });
          cells = [...cells, ...failedCells(batch, context, message)];
        }
      }
      current = {
        ...current,
        cells: mergeCells(current.cells, cells, { keepVerified: options.keepVerified }),
      };
      await options.save(current);
      options.onProgress?.(index + 1, targets.length);
    }
  } catch (cause) {
    if (cause instanceof BatchBudgetExceededError) return finish('PARTIAL');
    if (cause instanceof DOMException && cause.name === 'AbortError') return finish('CANCELLED');
    await finish('FAILED');
    throw cause;
  }
  return finish(run.errors.length ? 'PARTIAL' : 'COMPLETED');
}
