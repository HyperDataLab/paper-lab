import { describe, expect, it } from 'vitest';
import { grobidPaper, grobidResult } from '@/test/grobidFixtures';
import { pairLeftoverCitations, resolveCitation } from '../grobid/citationFallback';
import { grobidCitationsReferences } from './grobidCitations';

const reference = (id: string, surname: string, year = 2025) => ({
  id,
  authors: [{ forename: '', surname }],
  year,
  title: `Title ${id}`,
  venue: null,
  doi: null,
  arxivId: null,
  rawText: null,
});

describe('GROBID leftover pairing', () => {
  const citations = (...texts: string[]) =>
    texts.map((text) => ({ referenceId: null, text, sentence: text, page: 1 }));
  it('matches organisation text and a second author without regard to case or accents', () => {
    const refs = [
      { ...reference('org', ''), referenceText: 'Proceedings published by AAAI Press' },
      {
        ...reference('author', 'Other'),
        authors: [
          { forename: '', surname: 'Other' },
          { forename: '', surname: 'García' },
        ],
      },
    ];
    expect([...pairLeftoverCitations(citations('(AAAI, 2025)', '(garcia, 2025)'), refs)]).toEqual([
      [0, 'org'],
      [1, 'author'],
    ]);
    expect(
      pairLeftoverCitations(citations('(AAAI, 2025)'), [{ ...reference('org', ''), referenceText: 'XAAAIX' }])
        .size,
    ).toBe(0);
  });
  it('pairs a surname cut at a line-break hyphen only when one reference fits', () => {
    const cut = reference('cut', 'Shcherbiak', 2024);
    expect(pairLeftoverCitations(citations('Shcher-'), [cut]).get(0)).toBe('cut');
    expect(pairLeftoverCitations(citations('Shcher-'), [cut, { ...cut, id: 'twin' }]).size).toBe(0);
    expect(pairLeftoverCitations(citations('Sh-'), [cut]).size).toBe(0);
  });
  it('accepts missing years, rejects different years, and prefers exact years', () => {
    const missing = {
      ...reference('missing', 'Other'),
      authors: [
        { forename: '', surname: 'Other' },
        { forename: '', surname: 'Rao' },
      ],
      year: null,
    };
    const exact = { ...missing, id: 'exact', year: 2025 };
    expect(pairLeftoverCitations(citations('(Rao, 2025a)'), [missing]).get(0)).toBe('missing');
    expect(pairLeftoverCitations(citations('(Rao, 2025a)'), [{ ...missing, year: 2024 }]).size).toBe(0);
    expect(pairLeftoverCitations(citations('(Rao, 2025a)'), [missing, exact]).get(0)).toBe('exact');
  });
  it('pairs suffixes in order and leaves ambiguous claims unresolved', () => {
    const refs = ['first', 'second'].map((id) => ({
      ...reference(id, 'Other'),
      authors: [
        { forename: '', surname: 'Other' },
        { forename: '', surname: 'Li' },
      ],
    }));
    expect([...pairLeftoverCitations(citations('Li et al. (2025b)', 'Li et al. (2025a)'), refs)]).toEqual([
      [1, 'first'],
      [0, 'second'],
    ]);
    expect(pairLeftoverCitations(citations('(Li, 2025)'), refs).size).toBe(0);
    expect(pairLeftoverCitations(citations('(Li, 2025a)', '(Li, 2025b)', '(Li, 2025)'), refs).size).toBe(0);
  });
  it('marks leftover links and removes both findings', () => {
    const paper = structuredClone(grobidPaper);
    const body = paper.paragraphs[0];
    const refs = paper.paragraphs[1];
    if (!body || !refs) throw new Error('Fixture is incomplete');
    body.text = 'See (AAAI, 2025).';
    refs.text = 'Peer Review Assessment System.';
    const grobid = {
      ...grobidResult,
      references: [
        { ...reference('org', ''), title: 'Peer Review Assessment System', referenceText: 'AAAI Press' },
      ],
      citations: citations('(AAAI, 2025)'),
    };
    const result = grobidCitationsReferences(paper, grobid);
    expect(result.resolutions).toEqual([{ referenceId: 'org', matchedBy: 'leftover' }]);
    expect(result.check.findings).toEqual([]);
  });
});
const references = [
  reference('a', 'Rao'),
  reference('b', 'Rao'),
  reference('c', 'García'),
  reference('d', 'AAAI'),
];

describe('GROBID author-year fallback', () => {
  it('resolves suffixes in reference order, including grouped fragments', () => {
    expect(resolveCitation('(Rao et al., 2025a)', references)).toBe('a');
    expect(resolveCitation('Rao et al., 2025b;', references)).toBe('b');
    expect(resolveCitation('(Rao and Smith, 2025b;,', references)).toBe('b');
    expect(resolveCitation('(Rao & Smith, 2025a)', references)).toBe('a');
  });
  it('accepts a single case and diacritic insensitive match and an organisation', () => {
    expect(resolveCitation('(garcia, 2025)', references)).toBe('c');
    expect(resolveCitation('(AAAI, 2025)', references)).toBe('d');
  });
  it('leaves ambiguous unsuffixed and out-of-range suffixed citations unresolved', () => {
    expect(resolveCitation('(Rao, 2025)', references)).toBeNull();
    expect(resolveCitation('(Rao, 2025c)', references)).toBeNull();
  });
  it('uses explicit text suffixes even when reference order differs', () => {
    const refs = [
      { ...reference('b', 'Rao'), yearSource: 'text' as const, suffix: 'b' },
      { ...reference('a', 'Rao'), yearSource: 'text' as const, suffix: 'a' },
    ];
    expect(resolveCitation('(Rao, 2025a)', refs)).toBe('a');
    expect(resolveCitation('(Rao, 2025b)', refs)).toBe('b');
    expect(resolveCitation('(Rao, 2025c)', refs)).toBeNull();
  });
  it('uses a yearless reference only for a unique surname and an unsuffixed citation', () => {
    const yearless = { ...reference('a', 'Rao'), year: null };
    expect(resolveCitation('(Rao, 2025)', [yearless])).toBe('a');
    expect(resolveCitation('(Rao, 2025a)', [yearless])).toBeNull();
    expect(resolveCitation('(Rao, 2025)', [yearless, reference('b', 'Rao', 2024)])).toBeNull();
  });
  it('matches an organisation at the start of an analytic or monograph title', () => {
    expect(resolveCitation('(AAAI, 2025)', [{ ...reference('a', ''), title: 'AAAI: proceedings' }])).toBe(
      'a',
    );
    expect(resolveCitation('(AAAI, 2025)', [{ ...reference('b', ''), venue: 'AAAI Conference' }])).toBe('b');
  });
  it('counts fallback links as cited and skips a cut surname', () => {
    const paper = structuredClone(grobidPaper);
    const body = paper.paragraphs[0];
    const refs = paper.paragraphs[1];
    if (!body || !refs) throw new Error('Fixture is incomplete');
    body.text = 'See (Rao et al., 2025a) and Shcher-';
    refs.text = 'Title a. Title b.';
    const grobid = {
      ...grobidResult,
      references: references.slice(0, 2),
      citations: [
        { referenceId: null, text: '(Rao et al., 2025a)', sentence: body.text, page: 1 },
        { referenceId: null, text: 'Shcher-', sentence: body.text, page: 1 },
      ],
    };
    const { check, suppressed } = grobidCitationsReferences(paper, grobid);
    expect(check.findings.map((item) => item.id)).toEqual([expect.stringContaining('unused:grobid:b')]);
    expect(suppressed).toBe(1);
  });
});
