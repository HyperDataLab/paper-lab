import type { Corpus, CorpusLabelQueue, CorpusLabelScheme } from '../schemas/corpus';

export type LabelOutcome = { status: 'done' | 'skipped' } | { status: 'failed'; reason: string };

export function startLabelQueue(
  corpus: Corpus,
  input: {
    schemes: CorpusLabelScheme[];
    memberIds: string[];
    model: string;
    promptVersions: Partial<Record<CorpusLabelScheme, string>>;
    now: string;
  },
): Corpus {
  return {
    ...corpus,
    labelQueue: {
      status: 'running',
      schemes: input.schemes,
      model: input.model,
      promptVersions: input.promptVersions,
      pending: input.memberIds,
      counts: Object.fromEntries(input.schemes.map((s) => [s, { done: 0, failed: 0, skipped: 0 }])),
      failed: [],
      startedAt: input.now,
    },
  };
}

/** Records one member's outcomes and moves the queue to the next member. */
export function labelCheckpoint(
  corpus: Corpus,
  memberId: string,
  outcomes: Partial<Record<CorpusLabelScheme, LabelOutcome>>,
): Corpus {
  const queue = corpus.labelQueue;
  if (!queue || queue.pending[0] !== memberId) throw new Error('Invalid label checkpoint');
  const counts: CorpusLabelQueue['counts'] = { ...queue.counts };
  const failed = [...queue.failed];
  for (const scheme of queue.schemes) {
    const outcome = outcomes[scheme];
    if (!outcome) continue;
    const current = counts[scheme] ?? { done: 0, failed: 0, skipped: 0 };
    counts[scheme] = { ...current, [outcome.status]: current[outcome.status] + 1 };
    if (outcome.status === 'failed') failed.push({ memberId, scheme, reason: outcome.reason });
  }
  const pending = queue.pending.slice(1);
  return {
    ...corpus,
    // The status changes only in finishLabelQueue, which also writes the runs once.
    labelQueue: { ...queue, pending, counts, failed },
  };
}

/**
 * Pausing keeps the queue for "Tiếp tục". A finished or cancelled queue writes one `runs[]` entry per scheme
 * from the counters it kept across sessions, so a resumed run is reported as one run.
 */
export function finishLabelQueue(corpus: Corpus, status: 'paused' | 'cancelled' | 'complete', now: string) {
  const queue = corpus.labelQueue;
  if (!queue) return corpus;
  if (status === 'paused') return { ...corpus, labelQueue: { ...queue, status } };
  return {
    ...corpus,
    labelQueue: { ...queue, status },
    runs: [
      ...corpus.runs,
      ...queue.schemes.map((scheme) => ({
        scheme,
        model: queue.model,
        promptVersion: queue.promptVersions[scheme] ?? '',
        ...(queue.counts[scheme] ?? { done: 0, failed: 0, skipped: 0 }),
        createdAt: now,
      })),
    ],
  };
}

/** A queue a reload can pick up again. */
export const resumableLabelQueue = (queue: CorpusLabelQueue | undefined) =>
  Boolean(queue && queue.pending.length > 0 && (queue.status === 'running' || queue.status === 'paused'));
