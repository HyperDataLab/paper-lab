import { expect, it } from 'vitest';
import { buildGenerationPrompt, GenerationInputSchema, GenerationOutputSchema } from '../prompts/generation';
import { buildGeneration } from './buildGeneration';
import { checkProvenance } from './provenance';

const input = {
  mainClaim: 'Treatment may improve growth',
  evidence: [
    { id: 'e1', text: 'Treatment increased growth by 5 percent', citation: '(Smith et al., 2020)' },
    { id: 'e2', text: 'Other evidence', citation: null },
  ],
  audience: 'specialist',
  structure: 'TS-D',
  preserveTerms: ['growth'],
  hedging: 'keep_as_given',
} as const;
const output = {
  paragraph: 'Treatment may improve growth. Treatment increased growth by 5 percent (Smith et al., 2020).',
  sentences: [
    { text: 'Treatment may improve growth.', role: 'topic_sentence', evidenceIds: [], usesClaim: true },
    {
      text: 'Treatment increased growth by 5 percent (Smith et al., 2020).',
      role: 'development',
      evidenceIds: ['e1'],
      usesClaim: false,
    },
  ],
  needsEvidence: [],
};
const parsedInput = GenerationInputSchema.parse(input);
const parsedOutput = GenerationOutputSchema.parse(output);
const status = (text: string, ids = ['e1'], changes = {}) => {
  const out = {
    paragraph: text,
    sentences: [{ text, role: 'development' as const, evidenceIds: ids, usesClaim: true }],
    needsEvidence: [],
  };
  return checkProvenance({ ...parsedInput, ...changes }, out).overall;
};
it('WR-01 specifies evidence only, structure and Topic Action Stress and validates input', () => {
  const prompt = buildGenerationPrompt(parsedInput).system;
  expect(prompt).toContain('only with the listed evidence');
  expect(prompt).toContain('TS-D');
  expect(prompt).toContain('Topic–Action–Stress');
  expect(prompt).toContain('write its notes in Vietnamese');
  expect(GenerationInputSchema.safeParse({ ...input, evidence: [] }).success).toBe(false);
  expect(GenerationOutputSchema.safeParse({ paragraph: 'x' }).success).toBe(false);
});
it('WR-08 checks provenance and unused evidence', () => {
  const checks = checkProvenance(parsedInput, parsedOutput);
  expect(checks.overall.filter((c) => c.status === 'fail')).toEqual([]);
  expect(checks.unusedEvidence).toEqual(['e2']);
  const cases = [
    ['Treatment may improve growth by 9 percent.', ['e1'], 'numbers_from_inputs', 'fail'],
    ['Treatment may improve growth (Jones et al., 2021).', ['e1'], 'citations_from_inputs', 'fail'],
    ['Treatment showed growth.', [], 'evidence_ids_valid', 'warn'],
    ['Treatment proves growth.', ['e1'], 'claim_strength', 'fail'],
    ['Treatment may improve.', ['e1'], 'preserve_terms', 'fail'],
    ['Treatment may improve growth.', ['bad'], 'evidence_ids_valid', 'warn'],
  ] as const;
  for (const [text, ids, id, expected] of cases)
    expect(status(text, [...ids]).find((c) => c.id === id)?.status).toBe(expected);
});
it('WR-06 WR-08 fails when a negation in supplied evidence is dropped', () => {
  const checks = status('The treatment improved growth.', ['e1'], {
    mainClaim: 'Treatment affects growth',
    evidence: [{ id: 'e1', text: 'The treatment did not improve growth.', citation: null }],
  });
  expect(checks.find((item) => item.id === 'negation_preserved')?.status).toBe('fail');
});
it('WR-01 anchors Unicode sentence spans and suppresses unanchored sentences', () => {
  const built = buildGeneration(parsedInput, parsedOutput, {
    id: '123e4567-e89b-42d3-a456-426614174000',
    model: 'fake',
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  expect(built.sentences[1]?.span.start).toBe(30);
  const broken = buildGeneration(
    parsedInput,
    { ...parsedOutput, sentences: [{ ...parsedOutput.sentences[0]!, text: 'missing' }] },
    { id: built.id, model: 'fake', createdAt: built.createdAt },
  );
  expect(broken.sentences).toHaveLength(0);
  expect(broken.checks.overall.find((c) => c.id === 'sentence_coverage')?.status).toBe('fail');
  expect(broken.checks.unanchored).toMatchObject([
    { sentenceIndex: 0, text: 'missing', check: { status: 'fail' } },
  ]);
});

it('WR-01 retains sentence check alignment after an unanchored sentence', () => {
  const value = buildGeneration(
    parsedInput,
    {
      paragraph: 'Treatment may improve growth. Treatment increased growth by 9 percent.',
      sentences: [
        { text: 'Missing 12 percent.', role: 'lead', evidenceIds: ['e1'], usesClaim: false },
        { text: 'Treatment may improve growth.', role: 'topic_sentence', evidenceIds: [], usesClaim: true },
        {
          text: 'Treatment increased growth by 9 percent.',
          role: 'development',
          evidenceIds: ['e1'],
          usesClaim: false,
        },
      ],
      needsEvidence: [],
    },
    { id: '123e4567-e89b-42d3-a456-426614174000', model: 'fake', createdAt: '2025-01-01T00:00:00.000Z' },
  );
  expect(value.checks.unanchored).toMatchObject([
    { sentenceIndex: 0, text: 'Missing 12 percent.', check: { status: 'fail' } },
  ]);
  expect(
    value.checks.sentences.map((entry) => [
      entry.sentenceIndex,
      entry.checks.find((check) => check.id === 'numbers_from_inputs')?.status,
    ]),
  ).toEqual([
    [0, 'pass'],
    [1, 'fail'],
  ]);
});
