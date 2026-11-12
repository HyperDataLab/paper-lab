import { describe, expect, it } from 'vitest';
import { candidateFromWork, emptyDeep } from '../extraction/deep';
import { CorpusSchema, type Candidate, type Corpus } from '../schemas';
import { newCorpus } from './index';
import { addMember } from './intake';
import { canScreenFullText, latestDecision, recordDecision, suggestionFor } from './screening';

const at = '2026-01-01T00:00:00.000Z';
const later = '2026-01-02T00:00:00.000Z';
function corpusWithOne(): { corpus: Corpus; id: string } {
  const base = newCorpus({
    id: 'c',
    kind: 'topic',
    title: 'Synthetic',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] },
      },
    ],
  });
  const added = addMember(base, { doi: '10.1000/syn1', title: 'Synthetic record', year: 2020 }, at);
  if (added.matched !== 'new') throw new Error('fixture');
  return { corpus: added.corpus, id: added.memberId };
}
const member = (corpus: Corpus) => {
  const found = corpus.members[0];
  if (!found) throw new Error('fixture');
  return found;
};

describe('C3b screening', () => {
  it('C3b excluding requires a reason code, and "other" requires a reason text', () => {
    const { corpus, id } = corpusWithOne();
    const base = { stage: 'title-abstract' as const, decision: 'exclude' as const, person: 'An' };
    expect(recordDecision(corpus, id, base, at)).toEqual({ ok: false, error: 'reason-required' });
    expect(recordDecision(corpus, id, { ...base, reasonCode: 'other' }, at)).toEqual({
      ok: false,
      error: 'reason-text-required',
    });
    expect(recordDecision(corpus, id, { ...base, reasonCode: 'wrong_topic', person: ' ' }, at)).toEqual({
      ok: false,
      error: 'person-required',
    });
    const done = recordDecision(corpus, id, { ...base, reasonCode: 'other', reasonText: 'Editorial' }, at);
    expect(done.ok && member(done.corpus).decisions).toEqual([
      {
        stage: 'title-abstract',
        decision: 'exclude',
        reasonCode: 'other',
        reasonText: 'Editorial',
        decider: { kind: 'person', name: 'An' },
        at,
      },
    ]);
    const include = recordDecision(
      corpus,
      id,
      { ...base, decision: 'include', reasonCode: 'wrong_topic' },
      at,
    );
    expect(include.ok && member(include.corpus).decisions[0]?.reasonCode).toBe('');
  });

  it('C3b full-text screening is offered only after an include at title-abstract', () => {
    const { corpus, id } = corpusWithOne();
    const ft = { stage: 'full-text' as const, decision: 'include' as const, person: 'An' };
    expect(recordDecision(corpus, id, ft, at)).toEqual({ ok: false, error: 'full-text-before-include' });
    const included = recordDecision(
      corpus,
      id,
      { stage: 'title-abstract', decision: 'include', person: 'An' },
      at,
    );
    if (!included.ok) throw new Error('include');
    expect(canScreenFullText(member(included.corpus))).toBe(true);
    expect(recordDecision(included.corpus, id, ft, later).ok).toBe(true);
    const reversed = recordDecision(
      included.corpus,
      id,
      { stage: 'title-abstract', decision: 'uncertain', person: 'Bình' },
      later,
    );
    if (!reversed.ok) throw new Error('reverse');
    expect(canScreenFullText(member(reversed.corpus))).toBe(false);
  });

  it('C3b an AI suggestion becomes a decision only when a person accepts it', () => {
    const { corpus, id } = corpusWithOne();
    const candidate = candidateFromWork(
      {
        id: 'https://openalex.org/W9',
        doi: 'https://doi.org/10.1000/syn1',
        display_name: 'Synthetic record',
      },
      'q',
    ) as Candidate;
    const withSuggestion: Corpus = {
      ...corpus,
      deep: {
        ...emptyDeep(),
        candidates: [{ ...candidate, suggestion: { decision: 'excluded', reason: 'Model: off topic' } }],
      },
    };
    const suggestion = suggestionFor(withSuggestion, member(withSuggestion));
    expect(suggestion).toEqual({ decision: 'exclude', reason: 'Model: off topic' });
    // Shown, but not counted: the member has no decision yet.
    expect(latestDecision(member(withSuggestion), 'title-abstract')).toBeUndefined();
    if (!suggestion) throw new Error('suggestion');
    const base = { stage: 'title-abstract' as const, decision: 'exclude' as const, person: 'An' };
    expect(recordDecision(withSuggestion, id, { ...base, acceptedSuggestion: suggestion }, at)).toEqual({
      ok: false,
      error: 'reason-required',
    });
    const accepted = recordDecision(
      withSuggestion,
      id,
      { ...base, reasonCode: 'wrong_topic', acceptedSuggestion: suggestion },
      at,
    );
    if (!accepted.ok) throw new Error('accept');
    const decision = latestDecision(member(accepted.corpus), 'title-abstract');
    expect(decision).toMatchObject({
      decider: { kind: 'person', name: 'An' },
      reasonCode: 'wrong_topic',
      reasonText: '',
      acceptedSuggestion: { decision: 'exclude', reason: 'Model: off topic' },
    });
    // The marker survives a save: storage parses every write through the schema.
    expect(CorpusSchema.parse(accepted.corpus).members[0]?.decisions[0]?.acceptedSuggestion).toEqual(
      suggestion,
    );
  });

  it('C3b the latest person decision by time counts, never an AI-suggested entry', () => {
    const { corpus } = corpusWithOne();
    const one = member(corpus);
    const decision = (at: string, decision: 'include' | 'exclude', kind: 'person' | 'ai-suggestion') => ({
      stage: 'title-abstract' as const,
      decision,
      reasonCode: decision === 'exclude' ? 'wrong_topic' : '',
      reasonText: '',
      decider: { kind },
      at,
    });
    // Merged logs are concatenated, so a later entry can sit earlier in the array.
    const merged = {
      ...one,
      decisions: [
        decision(later, 'include', 'person'),
        decision(at, 'exclude', 'person'),
        decision('2026-02-01T00:00:00.000Z', 'exclude', 'ai-suggestion'),
      ],
    };
    expect(latestDecision(merged, 'title-abstract')?.decision).toBe('include');
  });
});
