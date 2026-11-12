import { expect, it } from 'vitest';
import { CLAIM_TYPES, CLAIM_TYPE_INFO } from './claimTypes';
import { ArgumentOutputSchema, ArgumentPendingSchema, ArgumentSchema } from '../schemas/paperInsights';
import { buildArgumentPrompt } from '../prompts';

it('CT covers every type and lists each in the prompt', () => {
  expect(CLAIM_TYPES).toHaveLength(12);
  for (const type of CLAIM_TYPES) {
    expect(CLAIM_TYPE_INFO[type]).toEqual({
      label: expect.any(String),
      vi: expect.any(String),
      needs: expect.any(String),
    });
    expect(buildArgumentPrompt([]).system).toContain(`${type}:`);
  }
});

it('CT parses a stored argument without a claim type', () => {
  const span = { paragraphId: 'p', sectionId: 's', page: null, start: 0, end: 1, excerpt: 'x' };
  const old = {
    id: 'a',
    importance: 'main',
    claim: span,
    data: [],
    statedWarrant: null,
    inferredWarrant: null,
    backing: [],
    qualifier: null,
    rebuttals: [],
  };
  expect(ArgumentSchema.parse(old).claimType).toBeNull();
});

it('CT restores old pending chunks while requiring a type on new output', () => {
  const old = {
    claim: { paragraphId: 'p', quote: 'x' },
    importance: 'main',
    data: [],
    statedWarrant: null,
    inferredWarrant: null,
    backing: [],
    qualifier: null,
    rebuttals: [],
  };
  expect(ArgumentOutputSchema.safeParse({ arguments: [old] }).success).toBe(false);
  const pending = ArgumentPendingSchema.parse({
    sectionIds: [],
    callsUsed: 1,
    model: 'm',
    chunks: { c: { arguments: [old] } },
  });
  expect(pending.chunks.c?.arguments[0]?.claimType).toBeNull();
});
