import { expect, it } from 'vitest';
import {
  ScgContributionSchema,
  ScgPaperRunSchema,
  SCG_TYPE_IDS,
  type PaperModelSentence,
  type ScgContribution,
  type ScgPaperRun,
} from '../schemas';
import {
  anchorScgEvidence,
  prefilterScg,
  scgContributionId,
  scgIdBase,
  scgIdBaseOf,
  scgPrerequisiteId,
  scgReviewCarry,
  setScgReview,
} from './index';

const sentence: PaperModelSentence = {
  key: 'abcdef0123456789#1',
  text: 'A model works.',
  displayId: 'p1_s1',
  paragraphId: 'p1',
  sectionId: 's1',
  page: null,
  start: 0,
  end: 14,
};
const contribution = (id: string, name: string, description = ''): ScgContribution => ({
  id,
  name,
  description,
  types: [{ type: 'models_or_architectures', explanation: 'A model.' }],
  sections: ['Intro'],
  prerequisites: [],
  sourceSentenceKeys: [sentence.key],
  review: 'candidate',
});
function scgRun(contributions: ScgContribution[], paperId = 'p'): ScgPaperRun {
  return {
    schemaVersion: 1,
    paperId,
    doi: null,
    s2CorpusId: null,
    s2CheckedAt: null,
    idBase: paperId,
    promptVersion: 'a+b+c',
    promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
    requestedModel: 'm',
    model: 'm',
    status: 'complete',
    callsUsed: 0,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    contributions,
    progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    reviewCarry: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

it('anchors only exact non-empty quotes and counts drops', () => {
  expect(
    anchorScgEvidence(
      [
        { sentenceKey: sentence.key, quote: 'model' },
        { sentenceKey: sentence.key, quote: '  ' },
        { sentenceKey: sentence.key, quote: 'missing' },
        { sentenceKey: 'unknown', quote: 'model' },
      ],
      [sentence],
    ),
  ).toEqual({ sourceSentenceKeys: [sentence.key], dropped: 3 });
});

it('an item with no anchored quote cannot be stored', () => {
  const item = contribution('p.c0', 'X');
  expect(ScgContributionSchema.safeParse(item).success).toBe(true);
  expect(ScgContributionSchema.safeParse({ ...item, sourceSentenceKeys: [] }).success).toBe(false);
});

it('uses the corpus id when available and the local paper id otherwise, counted from 0', () => {
  expect(scgContributionId(scgIdBase('local', '123'), 0)).toBe('123.c0');
  expect(scgContributionId(scgIdBase('local', null), 2)).toBe('local.c2');
  expect(scgPrerequisiteId('123.c0', 1)).toBe('123.c0.p1');
  expect(scgIdBaseOf('123.c0.p1')).toBe('123');
  expect(scgIdBaseOf('a.b.c4')).toBe('a.b');
});

it('keeps the 17 SCG type labels and rejects others', () => {
  expect(SCG_TYPE_IDS).toHaveLength(17);
  const item = contribution('p.c0', 'X');
  expect(
    ScgContributionSchema.safeParse({ ...item, types: [{ type: 'method', explanation: '' }] }).success,
  ).toBe(false);
  expect(ScgContributionSchema.safeParse({ ...item, types: [] }).success).toBe(false);
  expect(ScgContributionSchema.safeParse({ ...item, id: 'p-0' }).success).toBe(false);
  expect(ScgPaperRunSchema.safeParse(scgRun([item])).success).toBe(true);
  expect(ScgPaperRunSchema.safeParse({ ...scgRun([item]), status: 'bad' }).success).toBe(false);
});

it('prefilters on content words, not stopwords, and skips the own paper and rejected items', () => {
  const pool = [
    contribution('a.c0', 'Transformer encoder', 'Self-attention layers for text.'),
    contribution('a.c1', 'A study of the data'),
    contribution('b.c0', 'Transformer decoder'),
    { ...contribution('a.c2', 'Transformer pruning'), review: 'rejected' as const },
  ];
  const found = prefilterScg({ name: 'The transformer encoder', description: 'attention' }, pool);
  expect(found.map((item) => item.id)).toEqual(['a.c0', 'b.c0']);
  expect(
    prefilterScg({ name: 'Transformer encoder', description: '' }, pool, { excludeIdBase: 'a' }).map(
      (item) => item.id,
    ),
  ).toEqual(['b.c0']);
  expect(prefilterScg({ name: 'A study of the', description: '' }, pool)).toEqual([]);
});

it('sets reviews on contributions, prerequisites and matches, and carries them by name', () => {
  const item = contribution('p.c0', 'Encoder');
  item.prerequisites = [
    {
      id: 'p.c0.p0',
      name: 'Attention',
      description: '',
      explanation: '',
      coreOrPeripheral: 'core',
      references: [],
      matches: [{ contributionId: 'q.c0', explanation: '', matchType: 'strong', review: 'candidate' }],
      sourceSentenceKeys: [sentence.key],
      review: 'candidate',
    },
  ];
  let run = setScgReview(scgRun([item]), { contributionId: 'p.c0' }, 'accepted');
  run = setScgReview(run, { contributionId: 'p.c0', prerequisiteId: 'p.c0.p0' }, 'rejected');
  run = setScgReview(run, { contributionId: 'p.c0', prerequisiteId: 'p.c0.p0', matchId: 'q.c0' }, 'accepted');
  const updated = run.contributions[0];
  expect(updated?.review).toBe('accepted');
  expect(updated?.prerequisites[0]?.review).toBe('rejected');
  expect(updated?.prerequisites[0]?.matches[0]?.review).toBe('accepted');
  expect(scgReviewCarry(run)).toEqual({ 'c:encoder': 'accepted', 'p:encoder|attention': 'rejected' });
  // Undoing a decision clears the carried one too.
  const undone = setScgReview(
    { ...run, reviewCarry: scgReviewCarry(run) },
    { contributionId: 'p.c0' },
    'candidate',
  );
  expect(scgReviewCarry(undone)).toEqual({ 'p:encoder|attention': 'rejected' });
});
