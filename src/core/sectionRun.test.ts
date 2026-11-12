import { expect, it } from 'vitest';
import type { ArgumentRun, InsightDecision, RhetoricRun, StanceRun } from './schemas';
import {
  carryDecisions,
  mergeArgumentRuns,
  mergeRhetoricRuns,
  mergeStanceRuns,
  SectionRunMismatchError,
} from './sectionRun';

const OLD = '00000000-0000-4000-8000-0000000000a1';
const NEW = '00000000-0000-4000-8000-0000000000a2';
const MERGED = { id: '00000000-0000-4000-8000-0000000000a3', createdAt: '2026-11-11T00:00:00.000Z' };
const span = (sectionId: string, excerpt: string) => ({
  paragraphId: `p-${sectionId}`,
  sectionId,
  page: 1,
  start: 0,
  end: excerpt.length,
  excerpt,
});
const rhetoricItem = (id: string, sectionId: string, excerpt: string) => ({
  id,
  category: 'limitation' as const,
  rationale: '',
  ...span(sectionId, excerpt),
});
const rhetoric = (
  id: string,
  items: RhetoricRun['items'],
  sectionIds: string[],
  extra: Partial<RhetoricRun> = {},
): RhetoricRun => ({
  id,
  createdAt: '2026-11-10T00:00:00.000Z',
  model: 'm',
  promptVersion: 'rhetoric-1+align-1',
  callsUsed: 2,
  sectionIds,
  failedSectionIds: [],
  items,
  abstractClaims: [],
  abstractChecked: false,
  discarded: { not_found: 1, duplicate: 0 },
  ...extra,
});

it('R6 a section run replaces only that section, keeps the rest and the abstract comparison, and numbers new items after the kept ones', () => {
  const previous = rhetoric(
    OLD,
    [
      rhetoricItem('rh-1', 'intro', 'A'),
      rhetoricItem('rh-2', 'methods', 'B'),
      rhetoricItem('rh-3', 'intro', 'C'),
    ],
    ['intro', 'methods'],
    {
      abstractChecked: true,
      abstractClaims: [{ id: 'ac-1', claim: span('abs', 'Z'), support: null, rationale: '' }],
      failedSectionIds: ['methods'],
    },
  );
  const next = rhetoric(
    NEW,
    [rhetoricItem('rh-1', 'methods', 'B2'), rhetoricItem('rh-2', 'methods', 'B3')],
    ['methods'],
    {
      callsUsed: 1,
    },
  );
  const { run, keptIds } = mergeRhetoricRuns(previous, next, ['methods'], MERGED);
  expect(run.id).toBe(MERGED.id);
  expect(keptIds).toEqual(['rh-1', 'rh-3']);
  expect(run.items.map((item) => [item.id, item.excerpt])).toEqual([
    ['rh-1', 'A'],
    ['rh-3', 'C'],
    ['rh-4', 'B2'],
    ['rh-5', 'B3'],
  ]);
  expect(run.sectionIds).toEqual(['intro', 'methods']);
  // The rerun section was read again, so it is no longer listed as unread.
  expect(run.failedSectionIds).toEqual([]);
  expect(run.abstractChecked).toBe(true);
  expect(run.abstractClaims).toHaveLength(1);
  expect(run.callsUsed).toBe(3);
});

it('R6 decisions on kept items move to the merged run; decisions on replaced items do not', () => {
  const decisions: InsightDecision[] = [
    { run_id: OLD, item_id: 'rh-1', decision: 'confirm', at: '2026-11-10T01:00:00.000Z' },
    { run_id: OLD, item_id: 'rh-2', decision: 'dismiss', at: '2026-11-10T02:00:00.000Z' },
    { run_id: 'other-run', item_id: 'rh-1', decision: 'dismiss', at: '2026-11-10T03:00:00.000Z' },
  ];
  expect(carryDecisions(decisions, OLD, MERGED.id, ['rh-1', 'rh-3'], (item) => item.item_id)).toEqual([
    { run_id: MERGED.id, item_id: 'rh-1', decision: 'confirm', at: '2026-11-10T01:00:00.000Z' },
  ]);
});

it('R6 arguments belong to the section of their claim; stance keeps per-section word counts', () => {
  const argument = (id: string, sectionId: string) => ({
    id,
    importance: 'main' as const,
    claimType: null,
    claim: span(sectionId, id),
    data: [],
    statedWarrant: null,
    inferredWarrant: null,
    backing: [],
    qualifier: null,
    rebuttals: [],
  });
  const base = {
    createdAt: '2026-11-10T00:00:00.000Z',
    model: 'm',
    promptVersion: 'argument-1',
    callsUsed: 1,
    failedSectionIds: [],
    discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
  };
  const previous: ArgumentRun = {
    ...base,
    id: OLD,
    sectionIds: ['a', 'b'],
    arguments: [argument('arg-1', 'a'), argument('arg-2', 'b')],
  };
  const next: ArgumentRun = { ...base, id: NEW, sectionIds: ['b'], arguments: [argument('arg-1', 'b')] };
  const merged = mergeArgumentRuns(previous, next, ['b'], MERGED);
  expect(merged.keptIds).toEqual(['arg-1']);
  expect(merged.run.arguments.map((item) => [item.id, item.claim.sectionId])).toEqual([
    ['arg-1', 'a'],
    ['arg-2', 'b'],
  ]);

  const annotation = (id: string, sectionId: string) => ({
    id,
    paragraphId: `p-${sectionId}`,
    sectionId,
    page: 1,
    category: 'hedges' as const,
    marker: 'may',
    start: 0,
    end: 3,
    excerpt: 'may',
    rationale: '',
  });
  const stanceBase = {
    createdAt: '2026-11-10T00:00:00.000Z',
    model: 'm',
    promptVersion: 'stance-1',
    callsUsed: 1,
    failedSectionIds: [],
    discarded: { not_found: 0, wrong_form: 0, duplicate: 0 },
  };
  const stancePrevious: StanceRun = {
    ...stanceBase,
    id: OLD,
    sectionIds: ['a', 'b'],
    words: { a: 100, b: 50 },
    annotations: [annotation('sa-0001', 'a'), annotation('sa-0002', 'b')],
  };
  const stanceNext: StanceRun = {
    ...stanceBase,
    id: NEW,
    sectionIds: ['b'],
    words: { b: 60 },
    annotations: [annotation('sa-0001', 'b')],
  };
  const stance = mergeStanceRuns(stancePrevious, stanceNext, ['b'], MERGED);
  expect(stance.run.words).toEqual({ a: 100, b: 60 });
  expect(stance.run.annotations.map((item) => item.id)).toEqual(['sa-0001', 'sa-0002']);
  expect(stance.run.annotations[1]?.sectionId).toBe('b');
});

it('R6 a section run with another prompt or model is not merged into the old result', () => {
  const previous = rhetoric(OLD, [], ['a']);
  expect(() =>
    mergeRhetoricRuns(previous, rhetoric(NEW, [], ['a'], { model: 'other' }), ['a'], MERGED),
  ).toThrow(SectionRunMismatchError);
  expect(() =>
    mergeRhetoricRuns(
      previous,
      rhetoric(NEW, [], ['a'], { promptVersion: 'rhetoric-2+align-1' }),
      ['a'],
      MERGED,
    ),
  ).toThrow(SectionRunMismatchError);
});
