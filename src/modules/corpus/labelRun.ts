import { BatchBudgetExceededError } from '@/core/batch/runBatch';
import { finishLabelQueue, labelCheckpoint, type LabelOutcome } from '@/core/corpus/labelQueue';
import type { Corpus, CorpusMember } from '@/core/schemas/corpus';
import type { LlmClient } from '@/shared/llm/client';
import type { LlmConfig } from '@/shared/llm/config';
import { describeLlmError } from '@/shared/llm/describeError';
import { ConsentRequiredError } from '@/shared/llm/errors';
import { llmArgument } from '@/shared/llm/llmArgument';
import { llmRhetoric } from '@/shared/llm/llmRhetoric';
import { llmStance } from '@/shared/llm/llmStance';
import { budgetFor } from '@/shared/llm/runDefaults';
import type { Repositories } from '@/shared/storage/types';
import { labelCovered, labelEstimate, labelSections, type LabelPaper, type LabelScheme } from './labelPlan';
import { modelInputs } from './modelInputs';

export type LabelRunners = {
  rhetoric: typeof llmRhetoric;
  stance: typeof llmStance;
  arguments: typeof llmArgument;
};
export const DEFAULT_RUNNERS: LabelRunners = {
  rhetoric: llmRhetoric,
  stance: llmStance,
  arguments: llmArgument,
};

export type LabelDeps = {
  repo: Repositories;
  client: LlmClient;
  config: LlmConfig;
  signal?: AbortSignal;
  runners?: LabelRunners;
};

/** Members a labelling run covers: retrieved, with a built paper model. */
export const labelMembers = (corpus: Corpus) =>
  corpus.members.filter((m) => m.retrieval === 'retrieved' && m.inputs && m.identifiers.paperIds[0]);

export async function loadLabelPaper(member: CorpusMember, repo: Repositories): Promise<LabelPaper | null> {
  const id = member.identifiers.paperIds[0];
  if (!id) return null;
  const [paper, insights, stance] = await Promise.all([
    repo.papers.get(id),
    repo.paperInsights.get(id),
    repo.stance.get(id),
  ]);
  return paper ? { memberId: member.memberId, paper, insights, stance } : null;
}

const fatal = (cause: unknown) =>
  cause instanceof ConsentRequiredError || (cause instanceof DOMException && cause.name === 'AbortError');
/** As on the paper page: a run that returns after Pause or Cancel is not saved. */
function stopIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
const sameSections = (a: readonly string[] | undefined, b: readonly string[]) =>
  Boolean(a && a.length === b.length && a.every((id, i) => id === b[i]));

/** Runs one scheme on one paper with the paper page's own runner and storage, so the paper page shows the result. */
async function labelScheme(item: LabelPaper, scheme: LabelScheme, deps: LabelDeps): Promise<LabelOutcome> {
  if (labelCovered(item, scheme)) return { status: 'skipped' };
  const estimate = labelEstimate(item, scheme);
  if (!estimate) return { status: 'skipped' };
  const runners = deps.runners ?? DEFAULT_RUNNERS;
  const { paper } = item;
  const sectionIds = labelSections(paper, scheme);
  const common = {
    sectionIds,
    config: deps.config,
    signal: deps.signal,
    onRequest: () => {},
  };
  const budget = budgetFor(estimate);
  try {
    let incomplete: boolean;
    if (scheme === 'rhetoric') {
      const saved = item.insights?.rhetoricPending;
      const pending = saved && sameSections(saved.sectionIds, sectionIds) ? saved : null;
      const result = await runners.rhetoric(deps.client, paper, {
        ...common,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        onProgress: async (state) =>
          void (await deps.repo.paperInsights.saveRhetoricPending(paper.id, state)),
      });
      stopIfAborted(deps.signal);
      incomplete = result.incomplete;
      await deps.repo.paperInsights.saveRhetoricRun(paper.id, result.run, incomplete ? result.state : null);
    } else if (scheme === 'stance') {
      const saved = item.stance?.pending;
      const pending = saved && sameSections(saved.sectionIds, sectionIds) ? saved : null;
      const result = await runners.stance(deps.client, paper, {
        ...common,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        onProgress: async (state) => void (await deps.repo.stance.savePending(paper.id, state)),
      });
      stopIfAborted(deps.signal);
      incomplete = result.incomplete;
      await deps.repo.stance.saveRun(paper.id, result.run, incomplete ? result.state : null);
    } else {
      const saved = item.insights?.argumentPending;
      const pending = saved && sameSections(saved.sectionIds, sectionIds) ? saved : null;
      const result = await runners.arguments(deps.client, paper, {
        ...common,
        budget: (pending?.callsUsed ?? 0) + budget,
        pending,
        onProgress: async (state) =>
          void (await deps.repo.paperInsights.saveArgumentPending(paper.id, state)),
      });
      stopIfAborted(deps.signal);
      incomplete = result.incomplete;
      await deps.repo.paperInsights.saveArgumentRun(paper.id, result.run, incomplete ? result.state : null);
    }
    return incomplete ? { status: 'failed', reason: 'Một số phần chưa đọc được' } : { status: 'done' };
  } catch (cause) {
    if (fatal(cause)) throw cause;
    return {
      status: 'failed',
      reason:
        cause instanceof BatchBudgetExceededError
          ? 'Đã chạm trần số lượt gọi'
          : (describeLlmError(cause) ?? String(cause)),
    };
  }
}

export async function labelMember(member: CorpusMember, schemes: readonly LabelScheme[], deps: LabelDeps) {
  const item = await loadLabelPaper(member, deps.repo);
  const outcomes: Partial<Record<LabelScheme, LabelOutcome>> = {};
  for (const scheme of schemes)
    outcomes[scheme] = item
      ? await labelScheme(item, scheme, deps)
      : { status: 'failed', reason: 'Không tìm thấy paper' };
  // New runs change the model's inputs; recording them keeps the build card from listing the member as stale.
  const inputs = item ? await modelInputs(member, deps.repo, true).catch(() => null) : null;
  return { outcomes, inputs };
}

export type QueueControl = () => 'run' | 'pause' | 'cancel';

/**
 * Works through `labelQueue.pending` one member at a time. Each checkpoint re-reads the stored corpus first, so
 * review decisions or edits saved while the run is going are not overwritten.
 */
export async function runLabelQueue(options: {
  load: () => Promise<Corpus | undefined>;
  save: (corpus: Corpus) => Promise<void>;
  label: (member: CorpusMember, schemes: readonly LabelScheme[]) => ReturnType<typeof labelMember>;
  control: QueueControl;
  now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const load = async () => {
    const value = await options.load();
    if (!value) throw new Error('Không tìm thấy corpus');
    return value;
  };
  let failure: unknown = null;
  for (;;) {
    const corpus = await load();
    const queue = corpus.labelQueue;
    const memberId = queue?.pending[0];
    if (!queue || !memberId || options.control() !== 'run') break;
    const member = corpus.members.find((m) => m.memberId === memberId);
    let result: Awaited<ReturnType<typeof labelMember>>;
    try {
      result = member
        ? await options.label(member, queue.schemes)
        : {
            outcomes: Object.fromEntries(
              queue.schemes.map((s) => [s, { status: 'failed', reason: 'Không tìm thấy thành viên' }]),
            ),
            inputs: null,
          };
    } catch (cause) {
      // The member stays first in the queue; its saved partial state is picked up on resume.
      if (options.control() === 'run') failure = cause;
      break;
    }
    if (options.control() === 'cancel') break;
    const latest = await load();
    const next = labelCheckpoint(latest, memberId, result.outcomes);
    const inputs = result.inputs;
    await options.save({
      ...next,
      updatedAt: now(),
      members: inputs
        ? next.members.map((m) => (m.memberId === memberId ? { ...m, inputs } : m))
        : next.members,
    });
  }
  const latest = await load();
  const queue = latest.labelQueue;
  if (queue?.status === 'running') {
    const status =
      options.control() === 'cancel' ? 'cancelled' : queue.pending.length ? 'paused' : 'complete';
    await options.save({ ...finishLabelQueue(latest, status, now()), updatedAt: now() });
  }
  if (failure) throw failure;
}
