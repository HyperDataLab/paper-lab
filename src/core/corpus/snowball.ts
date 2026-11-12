import type { Candidate, Corpus, CorpusMember, CorpusSearch } from '../schemas';
import { latestDecision, isIncluded } from './screening';
import { recordSearch } from './topic';
import { currentRound } from './updateSearch';

export type SnowballDirection = 'backward' | 'forward';
export const SNOWBALL_SOURCES = {
  backward: 'snowball-backward',
  forward: 'snowball-forward',
} as const satisfies Record<SnowballDirection, string>;

type RequestSearch = Extract<CorpusSearch, { requestUrl: string }>;
export const isSnowballSearch = (search: CorpusSearch): search is RequestSearch =>
  'requestUrl' in search && search.source.startsWith('snowball-');

const snowballEntries = (corpus: Corpus) => corpus.searches.filter(isSnowballSearch);

/** Included members that can seed a round: OpenAlex is asked by work id, so a member needs one. */
export const seedCandidates = (corpus: Corpus): CorpusMember[] =>
  corpus.members.filter((member) => isIncluded(member) && member.identifiers.openalexId);

export type SnowballState = {
  /** The last iteration run in any direction; 0 before the first. */
  lastRound: number;
  lastRunAt: string | null;
  /** Included members never used as a seed and included after the last round: the next round's seeds. */
  nextSeeds: CorpusMember[];
  /** A round ran, and no study was included after it: snowballing has converged. */
  converged: boolean;
};

export function snowballState(corpus: Corpus): SnowballState {
  const entries = snowballEntries(corpus);
  const lastRound = Math.max(0, ...entries.map((entry) => entry.snowballRound ?? 0));
  const lastRunAt = entries.reduce<string | null>(
    (latest, entry) => (!latest || entry.runAt > latest ? entry.runAt : latest),
    null,
  );
  const used = new Set(entries.flatMap((entry) => entry.seeds ?? []));
  const nextSeeds = seedCandidates(corpus).filter((member) => {
    if (used.has(member.memberId)) return false;
    if (!lastRunAt) return true;
    const decision = latestDecision(member, 'full-text');
    return decision !== undefined && decision.at > lastRunAt;
  });
  return { lastRound, lastRunAt, nextSeeds, converged: lastRound > 0 && nextSeeds.length === 0 };
}

export type SnowballResult = {
  direction: SnowballDirection;
  seeds: string[];
  candidates: Candidate[];
  requestUrls: string[];
  totalReported: number;
  retrieved: number;
  truncated: boolean;
};

/** One iteration in one direction becomes one search entry; its records go through intake like any search. */
export function recordSnowball(corpus: Corpus, result: SnowballResult, round: number, at: string): Corpus {
  return recordSearch(
    corpus,
    result.candidates,
    {
      source: SNOWBALL_SOURCES[result.direction],
      requestUrl: result.requestUrls[0] ?? 'https://api.openalex.org/works',
      requestUrls: result.requestUrls,
      totalReported: result.totalReported,
      retrieved: result.retrieved,
      truncated: result.truncated,
      updateRound: currentRound(corpus),
      seeds: result.seeds,
      snowballRound: round,
    },
    at,
  );
}
