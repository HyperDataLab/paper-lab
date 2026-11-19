import { describe, expect, it } from 'vitest';
import { candidateFromWork, emptyDeep } from '../extraction/deep';
import { applyTriage, borderlineSample, triageBuckets, triagePending } from '../extraction/triage';
import { CorpusSchema, type Candidate, type CandidateSuggestion, type Corpus } from '../schemas';
import { newCorpus } from './index';
import { addMember } from './intake';
import { prismaCounts, screeningLogRows } from './prisma';
import { latestDecision, recordDecision } from './screening';
import { acceptCorpusTriage, corpusCriteria, storeTriage, triageView } from './triage';

const at = '2026-01-01T00:00:00.000Z';
const later = '2026-01-02T00:00:00.000Z';
const thresholds = { include: 0.7, exclude: 0.3 };
const scored = (relevance: number, matched: string[] = []): CandidateSuggestion => ({
  decision: relevance >= 0.7 ? 'included' : relevance < 0.3 ? 'excluded' : 'uncertain',
  reason: `Điểm ${relevance}`,
  relevance,
  quality: 0.5,
  matched,
  model: 'm',
  promptVersion: 'screening-triage-1',
});

/** Five synthetic members; W1–W4 came from a search (abstract on the record), the fifth from a DOI list. */
function fixture(): { corpus: Corpus; ids: string[] } {
  let corpus = newCorpus({
    id: 'c',
    kind: 'topic',
    title: 'Synthetic',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          researchQuestion: 'Độ trễ edge?',
          inclusion: ['edge computing'],
          exclusion: ['simulation only'],
          years: [],
        },
      },
    ],
  });
  const ids: string[] = [];
  const candidates: Candidate[] = [];
  for (let i = 1; i <= 5; i++) {
    const doi = `10.1000/syn${i}`;
    const added = addMember(
      corpus,
      { doi, title: `Paper ${i}`, year: 2020 },
      at,
      () => `00000000-0000-4000-8000-00000000000${i}`,
    );
    if (added.matched !== 'new') throw new Error('fixture');
    corpus = added.corpus;
    ids.push(added.memberId);
    if (i < 5)
      candidates.push({
        ...(candidateFromWork(
          { id: `https://openalex.org/W${i}`, doi: `https://doi.org/${doi}`, display_name: `Paper ${i}` },
          'q',
        ) as Candidate),
        abstract: `Abstract ${i}`,
      });
  }
  return { corpus: { ...corpus, deep: { ...emptyDeep(), candidates } }, ids };
}
const withScores = (corpus: Corpus, scores: Record<string, CandidateSuggestion>): Corpus => ({
  ...corpus,
  members: corpus.members.map((member) =>
    scores[member.memberId]
      ? { ...member, suggestions: { 'title-abstract': scores[member.memberId]! } }
      : member,
  ),
});

describe('R1 corpus:corpus screening triage', () => {
  it('R1 corpus:sees the stage members as candidates with the record abstract, and criteria from the protocol', () => {
    const { corpus, ids } = fixture();
    const view = triageView(corpus, 'title-abstract');
    expect(view.map((item) => item.key)).toEqual(ids);
    expect(view[0]).toMatchObject({
      title: 'Paper 1',
      abstract: 'Abstract 1',
      status: 'candidate',
      suggestion: null,
    });
    // A member with no search record is still triaged, from its title alone.
    expect(view[4]).toMatchObject({ title: 'Paper 5', abstract: null, status: 'candidate' });
    expect(corpusCriteria(corpus).map((item) => item.id)).toEqual(['I1', 'E1']);
    expect(triageView(corpus, 'full-text')).toEqual([]);
  });

  it('R1 corpus:stores a batch on the member suggestions without touching members decided meanwhile', () => {
    const { corpus, ids } = fixture();
    const before = triageView(corpus, 'title-abstract');
    const batch = before.slice(0, 3).map((item, index) => ({ label: `P${index + 1}`, key: item.key }));
    const output = {
      papers: batch.map((item, index) => ({
        label: item.label,
        relevance: [0.9, 0.1, 0.5][index]!,
        quality: 0.4,
        decision_suggestion: 'include' as const,
        matched_criteria: index === 1 ? ['E1', 'X9'] : ['I1'],
        reason: 'Lý do',
      })),
    };
    const after = applyTriage(before, batch, output, corpusCriteria(corpus), {
      model: 'm',
      promptVersion: 'screening-triage-1',
    });
    // A person decides the second member while the batch is out.
    const decided = recordDecision(
      corpus,
      ids[1]!,
      { stage: 'title-abstract', decision: 'include', person: 'An' },
      at,
    );
    if (!decided.ok) throw new Error('decide');
    const stored = storeTriage(decided.corpus, 'title-abstract', before, after, later);
    expect(stored.members[0]?.suggestions?.['title-abstract']).toMatchObject({
      relevance: 0.9,
      matched: ['I1'],
      reason: 'Lý do',
    });
    expect(stored.members[1]?.suggestions).toBeUndefined();
    expect(stored.members[2]?.suggestions?.['title-abstract']?.relevance).toBe(0.5);
    // Resume: only the members without scores are still pending.
    expect(triagePending(triageView(stored, 'title-abstract')).map((item) => item.key)).toEqual([
      ids[3],
      ids[4],
    ]);
    // The stored scores survive the schema every save and sync push parses through.
    expect(CorpusSchema.parse(stored).members[0]?.suggestions).toEqual(stored.members[0]?.suggestions);
  });

  it('R1 corpus:buckets follow the thresholds, with the exclusion override and a borderline sample', () => {
    const { corpus, ids } = fixture();
    const scoredCorpus = withScores(corpus, {
      [ids[0]!]: scored(0.9, ['I1']),
      [ids[1]!]: scored(0.85, ['E1']),
      [ids[2]!]: scored(0.1),
      [ids[3]!]: scored(0.5),
    });
    const view = triageView(scoredCorpus, 'title-abstract');
    const keys = (value: Record<string, Candidate[]>) =>
      Object.fromEntries(
        Object.entries(value).map(([bucket, list]) => [bucket, list.map((item) => item.key)]),
      );
    expect(keys(triageBuckets(view, thresholds))).toEqual({
      included: [ids[0]],
      excluded: [ids[1], ids[2]],
      uncertain: [ids[3]],
    });
    expect(keys(triageBuckets(view, { include: 0.4, exclude: 0.3 })).included).toEqual([ids[0], ids[3]]);
    expect(borderlineSample(view, thresholds, 2)).toHaveLength(2);
  });

  it('R1 corpus:bulk apply records person decisions with the accepted AI suggestion, and PRISMA counts follow', () => {
    const { corpus, ids } = fixture();
    const scoredCorpus = withScores(corpus, {
      [ids[0]!]: scored(0.9),
      [ids[1]!]: scored(0.1),
      [ids[2]!]: scored(0.2),
      [ids[3]!]: scored(0.5),
    });
    expect(prismaCounts(scoredCorpus)).toMatchObject({ recordsScreened: 0, awaitingScreening: 5 });
    // Excluding needs a reason code, and one failing check stops the whole apply.
    const keys = [ids[1]!, ids[2]!, ids[0]!];
    expect(
      acceptCorpusTriage(scoredCorpus, 'title-abstract', keys, 'excluded', thresholds, { person: 'An' }, at),
    ).toEqual({ ok: false, error: 'reason-required' });
    expect(
      acceptCorpusTriage(
        scoredCorpus,
        'title-abstract',
        keys,
        'excluded',
        thresholds,
        { person: ' ', reasonCode: 'wrong_topic' },
        at,
      ),
    ).toEqual({ ok: false, error: 'person-required' });
    const excluded = acceptCorpusTriage(
      scoredCorpus,
      'title-abstract',
      keys,
      'excluded',
      thresholds,
      { person: 'An', reasonCode: 'wrong_topic' },
      at,
    );
    if (!excluded.ok) throw new Error('apply');
    // The included member was not in the Loại bucket, so it stays undecided.
    expect(excluded.applied).toBe(2);
    expect(latestDecision(excluded.corpus.members[0]!, 'title-abstract')).toBeUndefined();
    expect(latestDecision(excluded.corpus.members[1]!, 'title-abstract')).toEqual({
      stage: 'title-abstract',
      decision: 'exclude',
      reasonCode: 'wrong_topic',
      reasonText: '',
      decider: { kind: 'person', name: 'An' },
      acceptedSuggestion: { decision: 'exclude', reason: 'Điểm 0.1' },
      at,
    });
    const included = acceptCorpusTriage(
      excluded.corpus,
      'title-abstract',
      [ids[0]!, ids[1]!],
      'included',
      thresholds,
      { person: 'An' },
      later,
    );
    if (!included.ok) throw new Error('apply');
    // A member already decided is never overwritten, even when its key is passed again.
    expect(included.applied).toBe(1);
    expect(prismaCounts(included.corpus)).toMatchObject({
      recordsScreened: 3,
      awaitingScreening: 2,
      excludedTitleAbstract: 2,
      reportsSought: 1,
      awaitingFullText: 1,
    });
    // The decision log names the person and the accepted suggestion.
    const log = screeningLogRows(included.corpus);
    expect(log).toHaveLength(4);
    expect(log[1]).toEqual(
      expect.arrayContaining(['exclude', 'wrong_topic', 'person: An', 'exclude: Điểm 0.1']),
    );
    // What a sync push sends: the schema keeps the decisions and the scores.
    const payload = JSON.parse(JSON.stringify(CorpusSchema.parse(included.corpus))) as Corpus;
    expect(payload.members[1]?.decisions[0]?.acceptedSuggestion).toEqual({
      decision: 'exclude',
      reason: 'Điểm 0.1',
    });
    expect(payload.members[0]?.suggestions?.['title-abstract']?.relevance).toBe(0.9);
    expect(prismaCounts(payload)).toEqual(prismaCounts(included.corpus));
  });

  it('R1 corpus:full-text triage covers only title-abstract includes and keeps its own suggestion', () => {
    const { corpus, ids } = fixture();
    const decided = recordDecision(
      corpus,
      ids[0]!,
      { stage: 'title-abstract', decision: 'include', person: 'An' },
      at,
    );
    if (!decided.ok) throw new Error('decide');
    const withTa = withScores(decided.corpus, { [ids[0]!]: scored(0.9) });
    const view = triageView(withTa, 'full-text');
    expect(view.map((item) => item.key)).toEqual([ids[0]]);
    // The title-abstract scores do not carry over to full text.
    expect(view[0]).toMatchObject({ status: 'candidate', suggestion: null });
    const stored = storeTriage(withTa, 'full-text', view, [{ ...view[0]!, suggestion: scored(0.2) }], later);
    expect(stored.members[0]?.suggestions).toMatchObject({
      'title-abstract': { relevance: 0.9 },
      'full-text': { relevance: 0.2 },
    });
    const done = acceptCorpusTriage(
      stored,
      'full-text',
      [ids[0]!],
      'excluded',
      thresholds,
      { person: 'An', reasonCode: 'wrong_outcome' },
      later,
    );
    if (!done.ok) throw new Error('apply');
    expect(prismaCounts(done.corpus)).toMatchObject({
      reportsAssessed: 1,
      reportsExcluded: 1,
      reportsExcludedByReason: { wrong_outcome: 1 },
    });
  });
});
