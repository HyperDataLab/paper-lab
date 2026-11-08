import { describe, expect, it } from 'vitest';
import type { Paper } from '../schemas';
import { runPaperChecks, validateLocations } from './index';

const at = '2026-01-01T00:00:00.000Z';
function paper(
  rows: [Paper['sections'][number]['role'], string, Paper['paragraphs'][number]['kind']?][],
): Paper {
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: rows.map(([role], i) => ({ id: `s${i}`, heading: '', role, level: 1, pageStart: null })),
    paragraphs: rows.map(([, text, kind = 'body'], i) => ({
      id: `p${i}`,
      sectionId: `s${i}`,
      order: i,
      text,
      kind,
      pageStart: null,
      textHash: '',
    })),
  };
}
const check = (p: Paper, id: string) => runPaperChecks(p, new Date(at)).checks.find((c) => c.id === id);
describe('P4 citations_references', () => {
  it('matches ranges and reports missing and unused entries', () => {
    const p = paper([
      ['introduction', 'See [1–3].'],
      ['references', '[1] Smith, 2020.', 'reference'],
      ['references', '[3] Lee, 2019.', 'reference'],
      ['references', '[4] Park, 2021.', 'reference'],
    ]);
    expect(check(p, 'citations_references')?.status).toBe('fail');
    expect(check(p, 'citations_references')?.findings.length).toBeGreaterThanOrEqual(3);
    expect(
      check(
        paper([
          ['introduction', 'See [1].'],
          ['references', '[1] Smith, 2020.', 'reference'],
        ]),
        'citations_references',
      )?.status,
    ).toBe('pass');
  });
  it('matches author-year suffixes and diacritics and handles absent references', () => {
    expect(
      check(
        paper([
          ['introduction', 'García et al. (2020a) agree.'],
          ['references', 'Garcia et al., 2020a.', 'reference'],
        ]),
        'citations_references',
      )?.status,
    ).toBe('pass');
    expect(check(paper([['introduction', 'Nothing.']]), 'citations_references')?.status).toBe(
      'not_applicable',
    );
  });
});
describe('P4 figures_tables', () => {
  it('matches Fig. with Figure and identifies missing captions and gaps', () => {
    expect(
      check(
        paper([
          ['results', 'See Fig. 1.'],
          ['results', 'Figure 1. Plot.', 'caption'],
        ]),
        'figures_tables',
      )?.status,
    ).toBe('pass');
    expect(
      check(
        paper([
          ['results', 'See Table 2.'],
          ['results', 'Table 3. Values.', 'caption'],
        ]),
        'figures_tables',
      )?.status,
    ).toBe('warn');
    expect(check(paper([]), 'figures_tables')?.status).toBe('not_applicable');
  });
});
describe('P4 acronyms', () => {
  it('P4 reports conflicting expansions with both definition locations', () => {
    const result = check(
      paper([
        ['methods', 'random forest (RF).'],
        ['methods', 'radio frequency (RF).'],
      ]),
      'acronyms',
    );
    expect(result?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining('duplicate:RF'),
          locations: expect.arrayContaining([
            expect.objectContaining({ paragraphId: 'p0' }),
            expect.objectContaining({ paragraphId: 'p1' }),
          ]),
        }),
      ]),
    );
  });
  it('recognizes definitions, plural and ignored acronyms and flags prior uses', () => {
    expect(
      check(paper([['methods', 'random forest (RF) works. RFs work. DNA works.']]), 'acronyms')?.status,
    ).toBe('pass');
    expect(check(paper([['methods', 'RF works. random forest (RF) works.']]), 'acronyms')?.status).toBe(
      'warn',
    );
    expect(check(paper([]), 'acronyms')?.status).toBe('not_applicable');
  });
});
describe('P4 numbers_consistency', () => {
  it('compares percentages and units against results', () => {
    expect(
      check(
        paper([
          ['abstract', 'Accuracy was 20%.'],
          ['results', 'Accuracy was 20%.'],
        ]),
        'numbers_consistency',
      )?.status,
    ).toBe('pass');
    expect(
      check(
        paper([
          ['abstract', 'Mass was 20 kg.'],
          ['results', 'Mass was 30 kg.'],
        ]),
        'numbers_consistency',
      )?.status,
    ).toBe('warn');
    expect(check(paper([['abstract', 'Mass was 20 kg.']]), 'numbers_consistency')?.status).toBe(
      'not_applicable',
    );
  });
});
describe('P4 claim_strength_drift', () => {
  it('pairs shared topics with hedges', () => {
    expect(
      check(
        paper([
          ['abstract', 'The treatment clearly improves patient survival.'],
          ['results', 'The treatment may improve patient survival.'],
        ]),
        'claim_strength_drift',
      )?.status,
    ).toBe('warn');
    expect(
      check(
        paper([
          ['abstract', 'The treatment improves patient survival.'],
          ['results', 'The treatment may improve patient survival.'],
        ]),
        'claim_strength_drift',
      )?.status,
    ).toBe('pass');
  });
});
describe('P4 unsupported_claims', () => {
  it('P4 anchors a reviewer section to its first nonempty paragraph', () => {
    const p = paper([['other', '😀 Response details.']]);
    const section = p.sections[0];
    const paragraph = p.paragraphs[0];
    if (!section || !paragraph) throw new Error('Missing fixture');
    p.sections[0] = { ...section, heading: 'Response to reviewers' };
    const finding = check(p, 'unsupported_claims')?.findings.find((f) => f.id.includes(':reviewers:'));
    expect(finding?.locations).toEqual([
      { paragraphId: 'p0', start: 0, end: Array.from(paragraph.text).length },
    ]);
    expect(finding?.evidence).toEqual(['😀 Response details.']);
  });
  it('suppresses supported claims and checks later proofs', () => {
    expect(
      check(paper([['results', 'Extensive experiments were performed.']]), 'unsupported_claims')?.status,
    ).toBe('warn');
    expect(
      check(paper([['results', 'Extensive experiments were performed (p < 0.05).']]), 'unsupported_claims')
        ?.status,
    ).toBe('pass');
    const noProof = check(
      paper([
        ['results', 'Theorem 1.'],
        ['results', 'Other text.'],
      ]),
      'unsupported_claims',
    );
    const proof = check(
      paper([
        ['results', 'Theorem 1.'],
        ['results', 'Proof.'],
      ]),
      'unsupported_claims',
    );
    expect(noProof?.findings.some((f) => f.id.includes(':theorem:'))).toBe(true);
    expect(proof?.findings.some((f) => f.id.includes(':theorem:'))).toBe(false);
  });
});
describe('P4 missing inputs', () => {
  it.each([
    ['citations_references', paper([])],
    ['citations_references', paper([['references', '[1] Smith, 2020.', 'reference']])],
    ['citations_references', paper([['results', 'A result.']])],
    ['figures_tables', paper([])],
    ['acronyms', paper([['results', 'Figure 1.', 'caption']])],
    ['numbers_consistency', paper([['abstract', 'A claim.']])],
    ['numbers_consistency', paper([['results', 'A result.']])],
    ['claim_strength_drift', paper([['abstract', 'A claim.']])],
    ['claim_strength_drift', paper([['results', 'A result.']])],
    ['unsupported_claims', paper([])],
  ])('P4 %s is not applicable without required inputs', (id, p) => {
    expect(check(p as Paper, id as string)).toMatchObject({ status: 'not_applicable', findings: [] });
  });
});
describe('P4 location validation', () => {
  it('uses code points, stable ids and drops invalid spans', () => {
    const p = paper([['results', '😀 See Figure 2.']]);
    const report = runPaperChecks(p, new Date(at));
    expect(runPaperChecks(p, new Date(at))).toEqual(report);
    const f = report.checks.find((c) => c.id === 'figures_tables')?.findings[0];
    if (!f) throw new Error('Missing finding');
    expect(f.locations[0]?.start).toBe(6);
    expect(validateLocations(p, [{ ...f, locations: [{ paragraphId: 'p0', start: 0, end: 100 }] }])).toEqual({
      findings: [],
      dropped: 1,
    });
  });
});
