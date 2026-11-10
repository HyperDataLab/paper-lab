import { describe, expect, it } from 'vitest';
import type { Paper, PaperParagraph, RhetoricRun } from '../schemas';
import {
  alignmentInputs,
  buildRhetoricRun,
  defaultRhetoricSections,
  insightStates,
  planRhetoric,
  rhetoricMetrics,
  verifyAlignment,
  verifyRhetoric,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const body = (id: string, sectionId: string, text: string): PaperParagraph => ({
  id,
  sectionId,
  order: 0,
  text,
  kind: 'body',
  textHash: id,
  pageStart: 2,
});
const section = (id: string, heading: string, role: Paper['sections'][number]['role']) => ({
  id,
  heading,
  role,
  level: 1,
  pageStart: 1,
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'a', pageCount: 1, sha256: 'x' },
  sections: [
    section('a', 'Abstract', 'abstract'),
    section('i', 'Introduction', 'introduction'),
    section('d', 'Data availability', 'other'),
    section('x', 'Acknowledgements', 'other'),
    section('rs', 'Results', 'results'),
    section('r', 'References', 'references'),
  ],
  paragraphs: [
    body('pa', 'a', 'We found a large effect.'),
    body('pi', 'i', 'Little is known about this topic.'),
    body('pd', 'd', 'Data are available on request.'),
    body('px', 'x', 'We thank the reviewers.'),
    body('pr', 'rs', 'The effect was large in all groups.'),
    body('pz', 'r', 'Ref.'),
  ],
};
const chunk = { id: 'c', paragraphs: paper.paragraphs.slice(1, 3) };
const output = {
  items: [
    { paragraphId: 'pi', quote: 'Little is known', category: 'niche' as const, rationale: 'r' },
    { paragraphId: 'pi', quote: 'Little is known', category: 'niche' as const, rationale: 'r' },
    { paragraphId: 'pi', quote: 'invented sentence', category: 'territory' as const, rationale: 'r' },
    { paragraphId: 'gone', quote: 'x', category: 'occupy' as const, rationale: 'r' },
  ],
};

describe('D3 rhetoric', () => {
  it('reads availability statements but not acknowledgements or references', () => {
    expect(defaultRhetoricSections(paper)).toEqual(['a', 'i', 'd', 'rs']);
    expect(planRhetoric(paper, ['i'])).toHaveLength(1);
  });
  it('keeps only quotes code can find, once each', () => {
    const verified = verifyRhetoric(output, chunk);
    expect(verified.items).toHaveLength(1);
    expect(verified.items[0]).toMatchObject({
      paragraphId: 'pi',
      start: 0,
      end: 15,
      excerpt: 'Little is known',
      page: 2,
    });
    expect(verified.discarded).toEqual({ not_found: 2, duplicate: 1 });
  });
  it('compares only the abstract against results, discussion and conclusion', () => {
    const inputs = alignmentInputs(paper, ['a', 'i', 'rs']);
    expect(inputs.abstract.map((p) => p.id)).toEqual(['pa']);
    expect(inputs.body.map((p) => p.id)).toEqual(['pr']);
    expect(alignmentInputs(paper, ['i']).abstract).toEqual([]);
  });
  it('stops adding body text at the size limit', () => {
    const long = {
      ...paper,
      paragraphs: [body('a1', 'rs', 'x'.repeat(39000)), body('a2', 'rs', 'y'.repeat(2000))],
    };
    expect(alignmentInputs(long, ['rs']).body.map((p) => p.id)).toEqual(['a1']);
  });
  it('treats an unfound support quote as no support and drops an unfound claim', () => {
    const { claims, notFound } = verifyAlignment(
      {
        claims: [
          {
            abstractParagraphId: 'pa',
            abstractQuote: 'a large effect',
            supportParagraphId: 'pr',
            supportQuote: 'effect was large',
            rationale: 'r',
          },
          {
            abstractParagraphId: 'pa',
            abstractQuote: 'We found',
            supportParagraphId: 'pr',
            supportQuote: 'not in the text',
            rationale: 'r',
          },
          {
            abstractParagraphId: 'pa',
            abstractQuote: 'We found a',
            supportParagraphId: null,
            supportQuote: null,
            rationale: 'r',
          },
          {
            abstractParagraphId: 'pa',
            abstractQuote: 'invented',
            supportParagraphId: null,
            supportQuote: null,
            rationale: 'r',
          },
        ],
      },
      [paper.paragraphs[0] as PaperParagraph],
      [paper.paragraphs[4] as PaperParagraph],
    );
    expect(claims.map((claim) => claim.support !== null)).toEqual([true, false, false]);
    expect(notFound).toBe(2);
  });
  const run = (
    results = { c: output },
    alignment: Parameters<typeof buildRhetoricRun>[0]['alignment']['output'] = null,
  ) =>
    buildRhetoricRun({
      id: '00000000-0000-4000-8000-000000000002',
      createdAt: at,
      model: 'm',
      promptVersion: 'p',
      callsUsed: 1,
      sectionIds: ['i'],
      chunks: [chunk, { id: 'lost', paragraphs: [paper.paragraphs[4] as PaperParagraph] }],
      results,
      alignment: { output: alignment, abstract: [paper.paragraphs[0] as PaperParagraph], body: [] },
    });
  it('records what could not be read', () => {
    const value = run();
    expect(value.failedSectionIds).toEqual(['rs']);
    expect(value.abstractChecked).toBe(false);
    expect(value.discarded).toEqual({ not_found: 2, duplicate: 1 });
  });
  const decide = (
    item_id: string,
    decision: 'confirm' | 'dismiss' | 'reopen',
    run_id = '00000000-0000-4000-8000-000000000002',
  ) => ({ run_id, item_id, decision, at });
  it('follows the latest human decision for this run only', () => {
    const value = { id: '00000000-0000-4000-8000-000000000002' };
    const states = insightStates(value, [
      decide('a', 'confirm'),
      decide('b', 'dismiss'),
      decide('b', 'reopen'),
      decide('c', 'dismiss', '00000000-0000-4000-8000-000000000009'),
    ]);
    expect([...states]).toEqual([['a', 'confirmed']]);
  });
  it('counts only what a person has not dismissed', () => {
    const value: RhetoricRun = {
      ...run(undefined, {
        claims: [
          {
            abstractParagraphId: 'pa',
            abstractQuote: 'We found',
            supportParagraphId: null,
            supportQuote: null,
            rationale: 'r',
          },
        ],
      }),
    };
    expect(rhetoricMetrics(value, [])).toMatchObject({ cars: ['niche'], supported: 0 });
    expect(rhetoricMetrics(value, []).claims).toHaveLength(1);
    expect(value.abstractChecked).toBe(true);
    const dismissed = rhetoricMetrics(value, [decide('rh-1', 'dismiss'), decide('ac-1', 'dismiss')]);
    expect(dismissed.cars).toEqual([]);
    expect(dismissed.claims).toEqual([]);
  });
});
