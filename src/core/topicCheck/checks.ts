import type { TopicCheck } from '../schemas/topicCheck';

// Rules of thumb, not validated research-methods thresholds.
export const TOPIC_THRESHOLDS = {
  sentences: 3,
  words: 90,
  debateWords: 40,
  saturationMin: 5,
  saturationMax: 500,
} as const;
type Status = 'missing' | 'needs_work' | 'ready' | 'not_applicable';
export type TopicCheckItem = { id: string; status: Status; reasonCode: string };
const filled = (s: string) => s.trim().length > 0;
const words = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length;
const sentences = (s: string) => s.split(/[.!?]+(?:\s+|$)/u).filter((part) => filled(part)).length;
export function evaluateTopicCheck(check: TopicCheck): TopicCheckItem[] {
  const item = (id: string, status: Status, reasonCode: string = status): TopicCheckItem => ({
    id,
    status,
    reasonCode,
  });
  const sorted = [...check.evidence].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  const duplication = sorted.find((e) => e.kind === 'duplication');
  const saturation = sorted.find((e) => e.kind === 'saturation');
  const impact = sorted.find((e) => e.kind === 'impact');
  const unread = duplication?.result.existing_reviews?.some((r) => !(check.reviewedIds ?? []).includes(r.id));
  const total = saturation?.result.total_estimate;
  const trajectories = impact?.result.papers ?? [];
  const validTrajectories = trajectories.length > 0 && trajectories.every((n) => n.ok && n.paper);
  const year = impact ? new Date(impact.ranAt).getUTCFullYear() : 0;
  const flat =
    validTrajectories &&
    trajectories.every((n) =>
      [year, year - 1, year - 2].every((y) => (n.paper?.counts_by_year[String(y)] ?? 0) <= 1),
    );
  return [
    item(
      'statement',
      !filled(check.statement)
        ? 'missing'
        : sentences(check.statement) > TOPIC_THRESHOLDS.sentences ||
            words(check.statement) > TOPIC_THRESHOLDS.words
          ? 'needs_work'
          : 'ready',
    ),
    item(
      'neighbours',
      !check.neighbours.length
        ? 'missing'
        : check.neighbours.some((n) => !filled(n.difference))
          ? 'needs_work'
          : 'ready',
    ),
    item(
      'debate',
      !filled(check.debate)
        ? 'missing'
        : words(check.debate) < TOPIC_THRESHOLDS.debateWords
          ? 'needs_work'
          : 'ready',
    ),
    item(
      'convergence',
      check.convergence.interest === null ||
        !filled(check.convergence.feasibility) ||
        check.convergence.debateAlive === null
        ? 'missing'
        : check.convergence.interest <= 2 || check.convergence.debateAlive === 'no'
          ? 'needs_work'
          : 'ready',
    ),
    item(
      'duplication',
      !duplication ? 'missing' : check.track === 'review' && unread ? 'needs_work' : 'ready',
    ),
    item(
      'feasibility',
      check.track !== 'review'
        ? 'not_applicable'
        : !saturation
          ? 'missing'
          : typeof total !== 'number'
            ? 'needs_work'
            : total < TOPIC_THRESHOLDS.saturationMin || total > TOPIC_THRESHOLDS.saturationMax
              ? 'needs_work'
              : 'ready',
      saturation && typeof total !== 'number' && check.track === 'review' ? 'unknown_total' : undefined,
    ),
    item(
      'impact',
      check.track !== 'study'
        ? 'not_applicable'
        : !impact
          ? 'missing'
          : !validTrajectories
            ? 'needs_work'
            : flat
              ? 'needs_work'
              : 'ready',
      impact && !validTrajectories && check.track === 'study' ? 'unknown_impact' : undefined,
    ),
    item(
      'pico',
      check.track !== 'review'
        ? 'not_applicable'
        : Object.values(check.pico).some((v) => !filled(v))
          ? 'missing'
          : 'ready',
    ),
    item(
      'plainSummary',
      !filled(check.plainSummary)
        ? 'missing'
        : sentences(check.plainSummary) > TOPIC_THRESHOLDS.sentences
          ? 'needs_work'
          : 'ready',
    ),
  ];
}
