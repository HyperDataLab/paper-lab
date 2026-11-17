import { describe, expect, it } from 'vitest';
import type { Argument, ArgumentRun, PaperParagraph } from '../schemas';
import { argumentMetrics, buildArgumentGraph, buildArgumentRun, verifyArguments } from './index';

const paragraph: PaperParagraph = {
  id: 'p',
  sectionId: 's',
  order: 0,
  text: 'AI review is unsafe. Scores rose 30%. Because scores reward style. Prior audits agree. This holds for LLMs. Some disagree.',
  kind: 'body',
  textHash: 'p',
  pageStart: 3,
};
const chunk = { id: 'c', paragraphs: [paragraph] };
const ref = (quote: string, paragraphId = 'p') => ({ paragraphId, quote });
const full = {
  claim: ref('AI review is unsafe'),
  importance: 'main' as const,
  claimType: 'causal' as const,
  data: [ref('Scores rose 30%')],
  statedWarrant: ref('Because scores reward style'),
  inferredWarrant: null,
  backing: [ref('Prior audits agree')],
  qualifier: ref('This holds for LLMs'),
  rebuttals: [ref('Some disagree')],
  evidenceLevel: 'E2' as const,
  evidenceBasis: 'Một benchmark, không có phương sai.',
};
const at = '2026-01-01T00:00:00.000Z';
const RUN = '00000000-0000-4000-8000-000000000002';
describe('D4 arguments', () => {
  it('keeps every slot it can verify', () => {
    const { items, discarded } = verifyArguments({ arguments: [full] }, chunk);
    expect(items[0]?.claim).toMatchObject({ excerpt: 'AI review is unsafe', page: 3, start: 0 });
    expect(items[0]?.claimType).toBe('causal');
    expect(items[0]?.statedWarrant?.excerpt).toBe('Because scores reward style');
    expect(items[0]?.rebuttals).toHaveLength(1);
    expect(discarded).toEqual({ claim_not_found: 0, element_not_found: 0, duplicate: 0 });
  });
  it('drops an argument whose claim is not in the paper, and duplicates', () => {
    const { items, discarded } = verifyArguments(
      { arguments: [{ ...full, claim: ref('made up') }, full, full] },
      chunk,
    );
    expect(items).toHaveLength(1);
    expect(discarded).toMatchObject({ claim_not_found: 1, duplicate: 1 });
  });
  it('leaves a slot empty when its quote fails, rather than inventing one', () => {
    const { items, discarded } = verifyArguments(
      {
        arguments: [
          {
            ...full,
            data: [ref('not there')],
            statedWarrant: ref('invented warrant'),
            inferredWarrant: 'không được dùng',
            qualifier: ref('invented', 'other'),
          },
        ],
      },
      chunk,
    );
    expect(items[0]).toMatchObject({ data: [], statedWarrant: null, inferredWarrant: null, qualifier: null });
    expect(discarded.element_not_found).toBe(3);
  });
  it('keeps an inferred warrant only where the authors state none, and marks it apart', () => {
    const { items } = verifyArguments(
      { arguments: [{ ...full, statedWarrant: null, inferredWarrant: 'Điểm phản ánh văn phong' }] },
      chunk,
    );
    expect(items[0]).toMatchObject({ statedWarrant: null, inferredWarrant: 'Điểm phản ánh văn phong' });
  });
  it('P7 keeps the evidence level and drops a basis that has no level', () => {
    expect(verifyArguments({ arguments: [full] }, chunk).items[0]).toMatchObject({
      evidenceLevel: 'E2',
      evidenceBasis: 'Một benchmark, không có phương sai.',
    });
    const { items } = verifyArguments({ arguments: [{ ...full, evidenceLevel: null }] }, chunk);
    expect(items[0]).toMatchObject({ evidenceLevel: null, evidenceBasis: null });
  });
  it('records what could not be read', () => {
    const run = buildArgumentRun({
      id: RUN,
      createdAt: at,
      model: 'm',
      promptVersion: 'p',
      callsUsed: 1,
      sectionIds: ['s'],
      chunks: [chunk],
      results: {},
    });
    expect(run.failedSectionIds).toEqual(['s']);
    expect(run.arguments).toEqual([]);
  });
  const span = (start: number, end: number, excerpt = 'x') => ({
    paragraphId: 'p',
    sectionId: 's',
    page: 1,
    start,
    end,
    excerpt,
  });
  const argument = (id: string, over: Partial<Argument>): Argument => ({
    id,
    importance: 'main',
    claimType: null,
    claim: span(0, 5),
    data: [],
    statedWarrant: null,
    inferredWarrant: null,
    backing: [],
    qualifier: null,
    rebuttals: [],
    ...over,
  });
  it('never links a premise straight to a conclusion', () => {
    const { nodes, edges } = buildArgumentGraph([
      argument('a', {
        data: [span(10, 15)],
        statedWarrant: span(20, 25),
        backing: [span(30, 35)],
        rebuttals: [span(40, 45)],
      }),
    ]);
    const kind = (id: string) => nodes.find((node) => node.id === id)?.kind;
    expect(edges.some((edge) => kind(edge.from) === 'I' && kind(edge.to) === 'I')).toBe(false);
    expect(nodes.filter((node) => node.kind !== 'I').every((node) => node.span === null)).toBe(true);
    expect(nodes.map((node) => node.kind).sort()).toEqual(['CA', 'I', 'I', 'I', 'I', 'I', 'RA']);
  });
  it('makes no RA node for a claim without premises', () => {
    const { nodes, edges } = buildArgumentGraph([argument('a', {})]);
    expect(nodes.map((node) => node.kind)).toEqual(['I']);
    expect(edges).toEqual([]);
  });
  it('joins a chain when one argument uses another argument claim as a premise', () => {
    const { nodes } = buildArgumentGraph([
      argument('a', { claim: span(0, 5), data: [span(10, 15)] }),
      argument('b', { claim: span(10, 15), data: [span(20, 25)] }),
    ]);
    expect(nodes.filter((node) => node.kind === 'I')).toHaveLength(3);
  });
  const run = (items: Argument[]): ArgumentRun => ({
    id: RUN,
    createdAt: at,
    model: 'm',
    promptVersion: 'p',
    callsUsed: 1,
    sectionIds: [],
    failedSectionIds: [],
    arguments: items,
    discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
  });
  it('reports each Toulmin slot separately and finds weak links', () => {
    const items = [
      argument('a', {
        claim: span(0, 5),
        data: [span(10, 15)],
        statedWarrant: span(20, 25),
        rebuttals: [span(40, 45)],
      }),
      argument('b', {
        claim: span(50, 55),
        inferredWarrant: 'x',
        qualifier: span(60, 65),
        backing: [span(70, 75)],
      }),
      argument('c', { importance: 'supporting', claim: span(10, 15) }),
      argument('d', { importance: 'supporting', claim: span(80, 85) }),
    ];
    const metrics = argumentMetrics(run(items), []);
    expect(metrics.main).toHaveLength(2);
    expect(metrics.withData).toEqual({ count: 1, total: 2 });
    expect(metrics.statedWarrant.count).toBe(1);
    expect(metrics.inferredWarrant.count).toBe(1);
    expect(metrics.withBacking.count).toBe(1);
    expect(metrics.withQualifier.count).toBe(1);
    expect(metrics.withRebuttal.count).toBe(1);
    expect(metrics.unsupported.map((item) => item.id)).toEqual(['b']);
    expect(metrics.dangling.map((item) => item.id)).toEqual(['d']);
  });
  it('leaves out what a person dismissed', () => {
    const metrics = argumentMetrics(run([argument('a', {}), argument('b', { claim: span(50, 55) })]), [
      { run_id: RUN, item_id: 'a', decision: 'dismiss', at },
    ]);
    expect(metrics.main.map((item) => item.id)).toEqual(['b']);
    expect(metrics.states.get('a')).toBe('dismissed');
  });
});
