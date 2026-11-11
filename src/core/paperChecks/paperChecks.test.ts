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
  it('P4 reports unsafe, out-of-bound and large numeric ranges without silently dropping them', () => {
    const result = check(
      paper([
        [
          'introduction',
          'See [1–1002], [9999–10000], [10001], [9007199254740992–9007199254740993] and [9999999999999999999999999999999999999999999999999999999999999999999–9999999999999999999999999999999999999999999999999999999999999999999].',
        ],
        ['references', '[9999] Example, 2024.', 'reference'],
        ['references', '[10000] Example, 2024.', 'reference'],
      ]),
      'citations_references',
    );
    expect(result?.findings.filter((f) => f.id.includes(':unchecked:'))).toHaveLength(4);
    expect(
      result?.findings
        .filter((f) => f.id.includes(':unchecked:'))
        .every((f) => f.message.includes('Không kiểm tra được')),
    ).toBe(true);
    expect(result?.findings.some((f) => f.id.includes(':missing:n:9999:'))).toBe(false);
    expect(result?.findings.some((f) => f.id.includes(':missing:n:10000:'))).toBe(false);
  });
  it('P4 groups missing author citations with every location and a use count', () => {
    const result = check(
      paper([
        ['introduction', 'The results (Morris, 2020) agree with Morris (2020).'],
        ['discussion', 'A different report (Morris, 2020) is relevant.'],
        ['references', 'A reference with no identifiable author.', 'reference'],
      ]),
      'citations_references',
    );
    const missing = result?.findings.filter((f) => f.id.includes(':missing:morris:2020:'));
    expect(missing).toHaveLength(1);
    expect(missing?.[0]?.locations).toHaveLength(3);
    expect(missing?.[0]?.evidence).toContain('3 lần trích dẫn');
  });
  it('P4 ignores table, heading, caption and non-author year labels while recognizing real author-year forms', () => {
    const result = check(
      paper([
        [
          'results',
          'FAccT 2025 and Æ 2026 are labels.\n| Smith, 2020 | 3.25 | Jones (2021) |\nPrior work (Smith, 2020; Brown et al., 2021a) agrees with Green and Lee (2019).',
        ],
        ['results', 'Figure 1. (Caption, 2022)', 'caption'],
        ['results', 'Heading (Heading, 2023)', 'heading_like'],
        ['references', 'Unidentified reference line.', 'reference'],
      ]),
      'citations_references',
    );
    const missing = result?.findings.filter((f) => f.id.includes(':missing:')) ?? [];
    expect(missing).toHaveLength(3);
    expect(missing.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('smith:2020'),
        expect.stringContaining('brown:2021a'),
        expect.stringContaining('green:2019'),
      ]),
    );
    expect(missing.every((f) => f.locations.every((location) => location.paragraphId === 'p0'))).toBe(true);
    expect(missing.find((f) => f.id.includes('smith:2020'))?.locations).toHaveLength(1);
  });
  it('P4 finds a surname and year across interrupted reference lines and skips incomplete unused entries', () => {
    const p = paper([
      ['introduction', 'Earlier work (Álvarez, 2021a) provides context.'],
      ['references', 'Baker, A., Cardenas, L., and Alvarez, Q.,', 'reference'],
      ['introduction', 'An unrelated body line is interleaved.'],
      ['references', 'Diaz, R., and Evans, T. Synthetic work on classification.', 'reference'],
      ['references', 'An Example Journal, volume 8, 2021a. Additional details follow.', 'reference'],
    ]);
    const first = p.paragraphs[1];
    if (!first) throw new Error('Missing reference');
    for (const paragraph of p.paragraphs.filter((paragraph) => paragraph.kind === 'reference'))
      paragraph.sectionId = first.sectionId;
    expect(check(p, 'citations_references')?.findings).toEqual([]);
  });
  it('P4 fallback requires surname boundaries, matching suffix and a year within 400 characters', () => {
    const atLimit = paper([
      ['introduction', 'See (Álvarez, 2021a).'],
      ['references', `Names include Alvarez${' '.repeat(400)}2021a.`, 'reference'],
    ]);
    expect(check(atLimit, 'citations_references')?.findings.some((f) => f.id.includes(':missing:'))).toBe(
      false,
    );
    for (const reference of [
      'Alvarezson, A. A report from 2021a.',
      `Citation text names Alvarez ${'x'.repeat(401)} 2021a.`,
      'Alvarez, A. A report from 2021b.',
    ]) {
      const p = paper([
        ['introduction', 'See (Álvarez, 2021a).'],
        ['references', reference, 'reference'],
      ]);
      expect(check(p, 'citations_references')?.findings.some((f) => f.id.includes(':missing:'))).toBe(true);
    }
  });
  it('P4 only reports unused references for clean author-year entries', () => {
    const p = paper([
      ['introduction', 'See (Rivera, 2024).'],
      ['references', 'Rivera, T. An example article, 2024.', 'reference'],
      ['references', 'Kim, A. Another example article, 2020.', 'reference'],
      ['references', 'Unfinished line without a publication year', 'reference'],
      ['references', 'A stray continuation with 2021.', 'reference'],
    ]);
    const result = check(p, 'citations_references');
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.locations[0]?.paragraphId).toBe('p2');
  });
  it('P4 matches realistic reference entries, continued entries, suffixes and author separators', () => {
    const p = paper([
      [
        'introduction',
        'Prior work (Álvarez, 2021; Chen et al., 2023a; Dubois & Miller, 2018; Patel and Wu, 2017) agrees.',
      ],
      [
        'references',
        'Alvarez, R. L. A study of review practices. Journal of Testing, 15:40–48, 2021.',
        'reference',
      ],
      ['references', 'Chen, H., Singh, P., and Wang, T. Measuring scientific reports.', 'reference'],
      ['references', 'Proceedings of the Example Conference, 2023a.', 'reference'],
      ['references', 'Dubois, M., and Miller, R. A synthetic analysis. Example Journal, 2018.', 'reference'],
      ['references', 'Patel, K., and Wu, Y. A separate result. Example Press, 2017.', 'reference'],
    ]);
    const refSection = p.paragraphs[1]?.sectionId;
    if (!refSection) throw new Error('Missing references');
    for (const paragraph of p.paragraphs.slice(2)) paragraph.sectionId = refSection;
    const result = check(p, 'citations_references');
    expect(result?.status).toBe('pass');
    expect(result?.findings).toEqual([]);
    expect(result?.summary).toBe('0 mục cần xem lại.');
  });
  it('P4 counts bounded numeric-gap findings instead of expanding large reference numbers', () => {
    const result = check(
      paper([
        ['introduction', 'The data are described in [4000000].'],
        ['references', '[4000000] Rivera, A. A synthetic article. Example Journal, 2024.', 'reference'],
      ]),
      'citations_references',
    );
    expect(result?.findings).toHaveLength(2);
    expect(result?.findings.some((f) => f.message.includes('1–3999999'))).toBe(true);
    expect(result?.findings.some((f) => f.message.includes('Không kiểm tra được'))).toBe(true);
    expect(result?.summary).toBe(`${result?.findings.length} mục cần xem lại.`);
  });
  it('P4 keeps suffix letters distinct and reports unused split references once', () => {
    const p = paper([
      ['introduction', 'The method follows (Nguyen et al., 2022b).'],
      ['references', 'Nguyen, Q., and Tran, H. A synthetic title.', 'reference'],
      ['references', 'Example proceedings, 2022a.', 'reference'],
    ]);
    const first = p.paragraphs[1];
    const continuation = p.paragraphs[2];
    if (!first || !continuation) throw new Error('Missing references');
    continuation.sectionId = first.sectionId;
    const result = check(p, 'citations_references');
    expect(result?.findings).toHaveLength(2);
    expect(result?.findings[1]?.locations).toHaveLength(2);
    expect(result?.summary).toBe('2 mục cần xem lại.');
  });
  it('matches ranges and reports missing and unused entries', () => {
    const p = paper([
      ['introduction', 'See [1–3].'],
      ['references', '[1] Smith, 2020.', 'reference'],
      ['references', '[3] Lee, 2019.', 'reference'],
      ['references', '[4] Park, 2021.', 'reference'],
    ]);
    expect(check(p, 'citations_references')?.status).toBe('fail');
    expect(check(p, 'citations_references')?.findings.length).toBeGreaterThanOrEqual(2);
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
  it.each(['Fig. 4', 'Figure 4', 'Figs. 4–5', 'Fig. 4(a)'])(
    'CRIT recognizes %s as a figure mention',
    (mention) => {
      const result = check(
        paper([
          ['results', `See ${mention}.`],
          ['results', 'Figure 4. Caption.', 'caption'],
        ]),
        'figures_tables',
      );
      expect(result?.findings.some((f) => f.id.includes(':unused:figure:4'))).toBe(false);
      expect(result?.findings.some((f) => f.id.includes(':missing:figure:4'))).toBe(false);
      if (mention.includes('4–5')) {
        const withFive = check(
          paper([
            ['results', `See ${mention}.`],
            ['results', 'Figure 5. Caption.', 'caption'],
          ]),
          'figures_tables',
        );
        expect(withFive?.findings.some((f) => f.id.includes(':unused:figure:5'))).toBe(false);
      }
    },
  );
  it('P4 reports large figure and table gaps as bounded ranges', () => {
    const result = check(
      paper([
        ['results', 'Figure 3. A caption.', 'caption'],
        ['results', 'Figure 1000. A caption.', 'caption'],
        ['results', 'Table 1000000000. A caption.', 'caption'],
      ]),
      'figures_tables',
    );
    const gaps = result?.findings.filter((f) => f.id.includes(':gap:')) ?? [];
    expect(gaps.map((f) => f.message)).toEqual([
      'Thiếu Hình 1–2.',
      'Thiếu Hình 4–999.',
      'Thiếu Bảng 1–999999999.',
    ]);
  });
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
  it('P4 skips lowercase words, uppercase lines and model names without suppressing real acronyms', () => {
    const result = check(
      paper([
        ['introduction', 'We use QXZ and QXZ for the measurement. The word output is ordinary language.'],
        [
          'appendix',
          'ALL NEW THE NOT ONLY EXACT OUTPUT\nReturn OUTPUT and OUTPUT in the response.\nPRINT RAW TOKENS QZZ QZZ\nA model uses GPT and BERT and LLaMA and T5.',
        ],
      ]),
      'acronyms',
    );
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.locations[0]?.paragraphId).toBe('p0');
    expect(result?.findings[0]?.evidence[0]).toBe('QXZ');
  });
  it('P4 groups repeated acronyms, ignores venues and excludes references and front matter', () => {
    const p = paper([
      ['title', 'ZXY ZXY'],
      ['other', 'JKL JKL'],
      [
        'introduction',
        'RFQ RFQ RFQs and ICLR AAAI NeurIPS ICML ACL EMNLP FAccT arXiv are discussed in this longer passage about scientific meetings and research.',
      ],
      ['introduction', 'RFQ and XYZ and ICML are discussed in additional ordinary prose.'],
      ['references', 'Taylor, A. RFQ RFQ XYZ XYZ. Example Press, 2024.', 'reference'],
    ]);
    const front = p.sections[1];
    if (!front) throw new Error('Missing front matter');
    front.heading = 'Front matter';
    const result = check(p, 'acronyms');
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.locations).toEqual([{ paragraphId: 'p2', start: 0, end: 3 }]);
    expect(result?.findings[0]?.evidence).toContain('4 lần xuất hiện trong nội dung');
  });
  it('P4 emits one first-use finding even when a defined acronym is repeatedly used early', () => {
    const result = check(
      paper([['methods', 'RFQ and RFQ. regional frequency quotient (RFQ) was tested. RFQ.']]),
      'acronyms',
    );
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.locations[0]).toEqual({ paragraphId: 'p0', start: 0, end: 3 });
    expect(result?.findings[0]?.evidence).toContain('4 lần xuất hiện trong nội dung');
  });
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
  it.each(['52.9 %', '52.90%'])('CRIT matches 52.9%% with %s', (value) => {
    const result = check(
      paper([
        ['abstract', 'Accuracy was 52.9%.'],
        ['results', `Accuracy was ${value}.`],
      ]),
      'numbers_consistency',
    );
    expect(result?.status).toBe('pass');
  });
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
