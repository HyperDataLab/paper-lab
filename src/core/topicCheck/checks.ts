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
  const evidence = (kind: TopicCheck['evidence'][number]['kind']) =>
    [...check.evidence].filter((e) => e.kind === kind).sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0];
  const duplication = evidence('duplication');
  const saturation = evidence('saturation');
  const impact = evidence('impact');
  const reviews = duplication?.result.reviews;
  const unread =
    Array.isArray(reviews) &&
    reviews.some((r: unknown) => typeof r !== 'object' || r === null || !('read' in r) || r.read !== true);
  const total = saturation?.result.total;
  const trajectories = impact?.result.neighbours;
  const validTrajectories =
    Array.isArray(trajectories) &&
    trajectories.length > 0 &&
    trajectories.every(
      (n: unknown) =>
        typeof n === 'object' &&
        n !== null &&
        'citationsPerYear' in n &&
        typeof n.citationsPerYear === 'number',
    );
  const flat =
    Array.isArray(trajectories) &&
    trajectories.length > 0 &&
    trajectories.every(
      (n: unknown) =>
        typeof n === 'object' &&
        n !== null &&
        'citationsPerYear' in n &&
        typeof n.citationsPerYear === 'number' &&
        n.citationsPerYear <= 0,
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
      !duplication
        ? 'missing'
        : check.track === 'review' && (!Array.isArray(reviews) || unread)
          ? 'needs_work'
          : 'ready',
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
