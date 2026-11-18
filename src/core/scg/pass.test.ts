import { expect, it } from 'vitest';
import type { PaperModelSentence, ScgContribution, ScgPaperRun } from '../schemas';
import { scgAlignmentCandidates, scgAlignmentGroups } from './align';
import {
  SCG_LIMITS,
  scgCallBound,
  scgContributionBatches,
  scgMergeDrafts,
  scgPrerequisiteGroups,
} from './pass';

const sentences = (count: number, sections: number): PaperModelSentence[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `${i.toString(16).padStart(16, '0')}#0`,
    text: `Sentence ${i}.`,
    displayId: `p_s${i}`,
    paragraphId: 'p',
    sectionId: `s${Math.floor((i * sections) / count)}`,
    page: null,
    start: 0,
    end: 1,
  }));

it('SCG batches whole sections and never takes more than 14 calls per paper', () => {
  const small = scgContributionBatches(sentences(100, 4));
  expect(small).toHaveLength(1);
  const sections = scgContributionBatches(sentences(300, 3));
  expect(sections.map((b) => b.length)).toEqual([100, 100, 100]);
  for (const [count, parts] of [
    [2000, 7],
    [900, 9],
    [5000, 40],
  ] as const) {
    const batches = scgContributionBatches(sentences(count, parts));
    expect(batches.length).toBeLessThanOrEqual(SCG_LIMITS.contributionBatches);
    expect(batches.flat()).toHaveLength(count);
    expect(scgCallBound(sentences(count, parts))).toBeLessThanOrEqual(14);
  }
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `p.c${i}` }) as ScgContribution);
  expect(scgPrerequisiteGroups(many).length).toBeLessThanOrEqual(SCG_LIMITS.prerequisiteGroups);
  expect(scgAlignmentGroups(Array.from({ length: 90 }, (_, i) => i)).length).toBeLessThanOrEqual(
    SCG_LIMITS.alignmentGroups,
  );
});

it('SCG merges duplicate contributions across batches by name before assigning ids', () => {
  const draft = (name: string, type: 'analysis' | 'other', key: string, description = '') => ({
    name,
    description,
    types: [{ type, explanation: '' }],
    sections: [key],
    sourceSentenceKeys: [key],
  });
  const merged = scgMergeDrafts(
    [
      [draft('Foo encoder', 'analysis', 'a')],
      [draft('foo  Encoder', 'other', 'b', 'Longer text.'), draft('Bar', 'other', 'c')],
    ],
    '42',
    { 'c:bar': 'rejected' },
  );
  expect(merged.map((c) => [c.id, c.name, c.review])).toEqual([
    ['42.c0', 'Foo encoder', 'candidate'],
    ['42.c1', 'Bar', 'rejected'],
  ]);
  expect(merged[0]?.types.map((t) => t.type)).toEqual(['analysis', 'other']);
  expect(merged[0]?.sourceSentenceKeys).toEqual(['a', 'b']);
  expect(merged[0]?.description).toBe('Longer text.');
});

it('SCG offers contributions of a cited lab paper even without shared words, never its own', () => {
  const contribution = (id: string, name: string): ScgContribution => ({
    id,
    name,
    description: '',
    types: [{ type: 'other', explanation: '' }],
    sections: [],
    prerequisites: [],
    sourceSentenceKeys: ['k'],
    review: 'candidate',
  });
  const run = (paperId: string, doi: string | null, contributions: ScgContribution[]) =>
    ({ paperId, idBase: paperId, doi, contributions }) as ScgPaperRun;
  const own = contribution('me.c0', 'Parser');
  own.prerequisites = [
    {
      id: 'me.c0.p0',
      name: 'Tokenizer',
      description: '',
      explanation: '',
      coreOrPeripheral: 'core',
      references: [
        { kind: 'paper', refId: 'ref1', title: 'T', year: null, doi: '10.1000/Cited', s2CorpusId: null },
      ],
      matches: [],
      sourceSentenceKeys: ['k'],
      review: 'candidate',
    },
  ];
  const candidates = scgAlignmentCandidates(run('me', null, [own, contribution('me.c1', 'Tokenizer')]), [
    run('me', null, [contribution('me.c1', 'Tokenizer')]),
    run('cited', '10.1000/cited', [contribution('cited.c0', 'Unrelated words')]),
    run('lexical', null, [contribution('lexical.c0', 'Fast tokenizer')]),
  ]);
  expect(candidates.get('me.c0.p0')?.map((c) => c.id)).toEqual(['cited.c0', 'lexical.c0']);
});
