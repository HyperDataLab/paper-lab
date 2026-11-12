import { describe, expect, it } from 'vitest';
import { candidateFromWork } from '../extraction/deep';
import type { Candidate, Corpus } from '../schemas';
import { newCorpus } from './index';
import { addMember, creditPending, mergeMembers } from './intake';
import { prismaBoxes, prismaCounts } from './prisma';
import { recordDecision, type DecisionInput } from './screening';
import { recordSnowball, snowballState, type SnowballResult } from './snowball';
import { recordTopicSearch } from './topic';
import { recordUpdateSearch, updateQueries } from './updateSearch';

const t = (day: number) => `2026-01-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const work = (n: string, title: string, year: number, doi = true) =>
  candidateFromWork(
    {
      id: `https://openalex.org/W${n}`,
      doi: doi ? `https://doi.org/10.1000/${n}` : null,
      display_name: title,
      publication_year: year,
    },
    'q',
  ) as Candidate;
const A = work('1', 'Alpha study', 2020);
const B = work('2', 'Beta study', 2021);
const C = work('3', 'Gamma study', 2019);
const D = work('4', 'Delta study', 2018);
const E = work('5', 'Epsilon study', 2022);
const BETA_AGAIN = work('9', 'Beta study', 2021, false);

const base = () =>
  newCorpus({
    id: 'snowball',
    kind: 'topic',
    title: 'Snowball review',
    createdAt: t(1),
    protocol: [
      {
        version: 1,
        createdAt: t(1),
        body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] },
      },
    ],
  });
const snowball = (direction: SnowballResult['direction'], seeds: string[], candidates: Candidate[]) => ({
  direction,
  seeds,
  candidates,
  requestUrls: [`https://api.openalex.org/works?filter=${direction}`],
  totalReported: candidates.length,
  retrieved: candidates.length,
  truncated: false,
});

/**
 * Hand-built review: OpenAlex finds A and B; A is included. Round 1 seeds A: backward brings B (duplicate), C, D
 * and a DOI-less "Beta study" 2021 (title-year match, waiting); forward brings E and C (duplicate). C is then
 * included and D excluded.
 */
function fixture(): Corpus {
  let corpus = recordTopicSearch(base(), [A, B], 'https://api.openalex.org/works?search=s', 2, 2, t(1));
  const id = (doi: string) => corpus.members.find((m) => m.identifiers.doi === doi)?.memberId ?? '';
  const decide = (memberId: string, input: Omit<DecisionInput, 'person'>, day: number) => {
    const result = recordDecision(corpus, memberId, { ...input, person: 'An' }, t(day));
    if (!result.ok) throw new Error(result.error);
    corpus = result.corpus;
  };
  decide(id('10.1000/1'), { stage: 'title-abstract', decision: 'include' }, 2);
  decide(id('10.1000/1'), { stage: 'full-text', decision: 'include' }, 2);
  const seeds = [id('10.1000/1')];
  corpus = recordSnowball(corpus, snowball('backward', seeds, [B, C, D, BETA_AGAIN]), 1, t(3));
  corpus = recordSnowball(corpus, snowball('forward', seeds, [E, C]), 1, t(3));
  decide(id('10.1000/3'), { stage: 'title-abstract', decision: 'include' }, 5);
  decide(id('10.1000/3'), { stage: 'full-text', decision: 'include' }, 5);
  decide(id('10.1000/4'), { stage: 'title-abstract', decision: 'exclude', reasonCode: 'wrong_topic' }, 5);
  return corpus;
}

describe('C3c snowballing', () => {
  it('C3c records each direction as a search entry with its seeds, requests and members', () => {
    const corpus = fixture();
    const [, backward, forward] = corpus.searches;
    expect(backward).toMatchObject({
      source: 'snowball-backward',
      snowballRound: 1,
      requestUrls: ['https://api.openalex.org/works?filter=backward'],
      totalReported: 4,
      retrieved: 4,
      added: 2,
      duplicates: 1,
      truncated: false,
      updateRound: 0,
    });
    expect(backward && 'seeds' in backward && backward.seeds).toHaveLength(1);
    expect(forward).toMatchObject({ source: 'snowball-forward', added: 1, duplicates: 1 });
    expect(corpus.pendingConfirmations?.[0]).toMatchObject({ source: 'snowball-backward', updateRound: 0 });
  });

  it('C3c next round seeds only studies included since the last round, and says when none were', () => {
    let corpus = fixture();
    const state = snowballState(corpus);
    expect(state.lastRound).toBe(1);
    expect(state.nextSeeds.map((m) => m.identifiers.doi)).toEqual(['10.1000/3']);
    expect(state.converged).toBe(false);
    corpus = recordSnowball(
      corpus,
      snowball(
        'backward',
        state.nextSeeds.map((m) => m.memberId),
        [],
      ),
      2,
      t(6),
    );
    expect(snowballState(corpus)).toMatchObject({ lastRound: 2, nextSeeds: [], converged: true });
  });

  it('C3c PRISMA counts citation searching as other methods, and the totals add up', () => {
    const counts = prismaCounts(fixture());
    expect(counts.databases).toMatchObject({
      identified: 2,
      duplicatesRemoved: 0,
      awaitingDuplicateCheck: 0,
      recordsOutsideSearches: 0,
      members: 2, // A B
      recordsScreened: 1,
      awaitingScreening: 1,
      reportsSought: 1,
      reportsAssessed: 1,
      studiesIncluded: 1, // A
    });
    expect(counts.otherMethods).toMatchObject({
      identified: 6, // B C D Beta' backward, E C forward
      duplicatesRemoved: 2, // B, then C again
      awaitingDuplicateCheck: 1, // Beta'
      recordsOutsideSearches: 0,
      members: 3, // C D E
      recordsScreened: 2,
      awaitingScreening: 1, // E
      excludedTitleAbstract: 1, // D
      reportsSought: 1,
      reportsNotRetrieved: 0,
      reportsAssessed: 1,
      studiesIncluded: 1, // C
    });
    expect(counts.otherMethods.sources.map((s) => s.kind)).toEqual(['citation', 'citation']);
    expect(counts.sources.map((s) => s.source)).toEqual(['openalex']);
    const c = counts;
    expect(c).toMatchObject({ identified: 2, identifiedOtherMethods: 6, members: 5, studiesIncluded: 2 });
    expect(
      c.identified +
        c.identifiedOtherMethods -
        c.duplicatesRemoved -
        c.awaitingDuplicateCheck +
        c.recordsOutsideSearches,
    ).toBe(c.members);
    expect(c.recordsScreened + c.awaitingScreening).toBe(c.members);
    expect(c.reportsExcluded + c.uncertainFullText + c.studiesIncluded).toBe(c.reportsAssessed);
    const boxes = prismaBoxes(counts);
    expect(boxes.filter((box) => box.column === 'otherMethods' && box.kind === 'source')).toHaveLength(2);
    expect(boxes.at(-1)).toMatchObject({ column: 'total', key: 'studiesIncluded', n: 2 });
  });

  it('C3c a citation record confirmed as a duplicate stays in the other-methods column', () => {
    const corpus = fixture();
    const pending = corpus.pendingConfirmations?.[0];
    if (!pending) throw new Error('no pending record');
    const added = addMember(
      { ...corpus, members: corpus.members.filter((m) => m.memberId !== pending.candidate) },
      pending.input,
      t(7),
    );
    if (added.matched !== 'new') throw new Error('not new');
    const member = added.corpus.members.find((m) => m.memberId === added.memberId);
    if (!member) throw new Error('no member');
    let next = mergeMembers(
      { ...corpus, members: [...corpus.members, member] },
      member.memberId,
      pending.candidate,
      'title-year confirmed',
      t(7),
    );
    next = { ...creditPending(next, pending, member.memberId, true), pendingConfirmations: [] };
    const counts = prismaCounts(next);
    expect(counts.otherMethods).toMatchObject({
      duplicatesRemoved: 3,
      awaitingDuplicateCheck: 0,
      recordsOutsideSearches: 0,
      members: 3,
    });
    expect(counts.databases.recordsOutsideSearches).toBe(0);
    // Kept apart instead, the new member counts as a citation-searching record.
    const apart = {
      ...creditPending({ ...corpus, members: [...corpus.members, member] }, pending, member.memberId, false),
      pendingConfirmations: [],
    };
    expect(prismaCounts(apart).otherMethods).toMatchObject({
      duplicatesRemoved: 2,
      members: 4,
      recordsOutsideSearches: 0,
    });
  });
});

describe('C3c update searches', () => {
  const withQueries = () => {
    let corpus = recordTopicSearch(
      base(),
      [A],
      'https://api.openalex.org/works?search=edge%20fog&filter=from_publication_date:2020-01-01,to_publication_date:2030-12-31&per-page=50&select=id',
      1,
      1,
      t(1),
    );
    corpus = recordTopicSearch(
      corpus,
      [B],
      'https://api.openalex.org/works?search=latency&per-page=50',
      1,
      1,
      t(3),
    );
    return corpus;
  };

  it('C3c re-runs each stored query from the day after its last run, tagged with the next round', () => {
    let corpus = withQueries();
    const queries = updateQueries(corpus);
    expect(queries.map((q) => q.url)).toEqual([
      'https://api.openalex.org/works?search=edge%20fog&filter=to_publication_date:2030-12-31,from_publication_date:2026-01-02&per-page=50&select=id',
      'https://api.openalex.org/works?search=latency&filter=from_publication_date:2026-01-04&per-page=50',
    ]);
    expect(queries[0]?.query).toBe('edge fog');
    const first = queries[0];
    if (!first) throw new Error('no query');
    corpus = recordUpdateSearch(
      corpus,
      [C],
      { url: first.url, total: 1, retrieved: 1 },
      1,
      '2026-03-05T23:30:00.000Z',
    );
    expect(corpus.searches.at(-1)).toMatchObject({ source: 'openalex', updateRound: 1, added: 1 });
    // The next update groups round 0 and round 1 runs of a query and starts after the latest one.
    const again = updateQueries(corpus);
    expect(again).toHaveLength(2);
    expect(again[0]?.from).toBe('2026-03-06');
    expect(again[1]?.from).toBe('2026-01-04');
  });

  it('C3c PRISMA can show every round or the latest update only', () => {
    let corpus = withQueries();
    const url = updateQueries(corpus)[0]?.url ?? '';
    corpus = recordUpdateSearch(corpus, [C, A], { url, total: 2, retrieved: 2 }, 1, t(9));
    const all = prismaCounts(corpus);
    expect(all).toMatchObject({ round: null, identified: 4, members: 3, duplicatesRemoved: 1 });
    const latest = prismaCounts(corpus, 'latest');
    expect(latest).toMatchObject({ round: 1, identified: 2, members: 1, duplicatesRemoved: 1 });
    expect(latest.sources).toHaveLength(1);
    expect(latest.recordsOutsideSearches).toBe(0);
  });
});
