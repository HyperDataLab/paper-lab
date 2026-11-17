import { expect, it } from 'vitest';
import { EVIDENCE_LEVELS, EVIDENCE_LEVEL_INFO, evidenceLevelDistribution } from './evidenceLevels';
import { ArgumentOutputSchema, ArgumentPendingSchema, ArgumentSchema } from '../schemas/paperInsights';
import { buildArgumentPrompt, PROMPT_VERSIONS } from '../prompts';

const ref = { paragraphId: 'p', quote: 'x' };
const oldOutput = {
  claim: ref,
  claimType: null,
  importance: 'main',
  data: [],
  statedWarrant: null,
  inferredWarrant: null,
  backing: [],
  qualifier: null,
  rebuttals: [],
};
const span = { paragraphId: 'p', sectionId: 's', page: null, start: 0, end: 1, excerpt: 'x' };
const oldStored = { ...oldOutput, id: 'a', claim: span };

it('P7 the prompt is bumped and defines every level, judged from the paper text only', () => {
  expect(PROMPT_VERSIONS.argument).toBe('argument-4');
  const { system } = buildArgumentPrompt([]);
  for (const level of EVIDENCE_LEVELS) {
    expect(system).toContain(`${level}: ${EVIDENCE_LEVEL_INFO[level].definition}`);
  }
  expect(system).toContain("Judge only from this paper's own text");
  expect(system).toContain('evidenceBasis');
});

it('P7 stored arguments and pending chunks from argument-3 still parse', () => {
  const stored = ArgumentSchema.parse(oldStored);
  expect(stored.evidenceLevel).toBeUndefined();
  const pending = ArgumentPendingSchema.parse({
    sectionIds: [],
    callsUsed: 1,
    model: 'm',
    chunks: { c: { arguments: [oldOutput] } },
  });
  expect(pending.chunks.c?.arguments[0]).toMatchObject({ evidenceLevel: null, evidenceBasis: null });
});

it('P7 new output carries a level and its basis, and an unknown level is rejected', () => {
  const next = { ...oldOutput, evidenceLevel: 'E3', evidenceBasis: 'Có khoảng tin cậy qua 5 lần chạy.' };
  expect(ArgumentOutputSchema.parse({ arguments: [next] }).arguments[0]?.evidenceLevel).toBe('E3');
  expect(ArgumentSchema.parse({ ...oldStored, evidenceLevel: 'E3', evidenceBasis: 'b' }).evidenceLevel).toBe(
    'E3',
  );
  expect(ArgumentOutputSchema.safeParse({ arguments: [{ ...next, evidenceLevel: 'E6' }] }).success).toBe(
    false,
  );
  // Strict JSON-schema output asks the model for the field, even if it is null.
  expect(ArgumentOutputSchema.safeParse({ arguments: [oldOutput] }).success).toBe(false);
});

it('P7 distribution pools main claims over papers and counts claims without a level', () => {
  const main = (evidenceLevel?: (typeof EVIDENCE_LEVELS)[number] | null) => ({
    importance: 'main' as const,
    evidenceLevel,
  });
  const result = evidenceLevelDistribution([
    { arguments: [main('E3'), main('E3'), main(null), { importance: 'supporting', evidenceLevel: 'E0' }] },
    { arguments: [main('E1'), main('E5'), main()] },
    { arguments: [] },
  ]);
  expect(result.shares).toEqual({ E0: 0, E1: 0.25, E2: 0, E3: 0.5, E4: 0, E5: 0.25 });
  expect(result).toMatchObject({ counted: 4, missing: 2, papers: 3, papersWithLevel: 2 });
  expect(Object.keys(result.shares)).toEqual([...EVIDENCE_LEVELS]);
});

it('P7 distribution with no graded claim returns zero shares for all six levels', () => {
  const result = evidenceLevelDistribution([{ arguments: [{ importance: 'main', evidenceLevel: null }] }]);
  expect(result.shares).toEqual({ E0: 0, E1: 0, E2: 0, E3: 0, E4: 0, E5: 0 });
  expect(result).toMatchObject({ counted: 0, missing: 1 });
});
