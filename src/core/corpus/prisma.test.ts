import { describe, expect, it } from 'vitest';
import { candidateFromWork } from '../extraction/deep';
import type { Candidate, Corpus } from '../schemas';
import { newCorpus } from './index';
import { addFromDois, mergeMembers } from './intake';
import { prismaBoxes, prismaCounts, screeningLogRows, toCsv } from './prisma';
import { recordDecision, type DecisionInput } from './screening';
import { parseRis, recordImport } from './searchImport';
import { recordTopicSearch } from './topic';

const t = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const work = (n: string, title: string, year: number) =>
  candidateFromWork(
    {
      id: `https://openalex.org/W${n}`,
      doi: `https://doi.org/10.1000/${n}`,
      display_name: title,
      publication_year: year,
    },
    'q',
  ) as Candidate;
const ris = `TY  - JOUR
TI  - Alpha study
PY  - 2020
DO  - 10.1000/a
ER  -
TY  - JOUR
TI  - Delta study
PY  - 2022
DO  - 10.1000/d
ER  -
TY  - JOUR
TI  - Epsilon study
PY  - 2020
ER  -
TY  - JOUR
TI  - Beta Study
PY  - 2021
ER  -
`;

/**
 * Hand-built review: OpenAlex finds A, B, C (3 of 10 reported, truncated); a RIS file brings A again (duplicate),
 * D and E (new) and "Beta Study" 2021 without DOI (title-year match, waiting); a DOI list adds G, H and I,
 * then H is merged into G.
 */
function fixture(): Corpus {
  let corpus = newCorpus({
    id: 'prisma',
    kind: 'topic',
    title: 'Synthetic review',
    createdAt: t(1),
    protocol: [
      {
        version: 1,
        createdAt: t(1),
        body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] },
      },
    ],
  });
  corpus = recordTopicSearch(
    corpus,
    [work('a', 'Alpha study', 2020), work('b', 'Beta study', 2021), work('c', 'Gamma study', 2019)],
    'https://api.openalex.org/works?search=synthetic',
    10,
    3,
    t(1),
  );
  corpus = recordImport(corpus, 'scopus.ris', parseRis(ris), t(1)).corpus;
  corpus = addFromDois(corpus, '10.1000/g\n10.1000/h\n10.1000/i', { now: t(1) }).corpus;
  const id = (doi: string) => corpus.members.find((m) => m.identifiers.doi === doi)?.memberId ?? '';
  const titled = (title: string) => corpus.members.find((m) => m.title === title)?.memberId ?? '';
  corpus = mergeMembers(corpus, id('10.1000/h'), id('10.1000/g'), 'same paper', t(1));
  const decide = (memberId: string, input: Omit<DecisionInput, 'person'>, day: number) => {
    const result = recordDecision(corpus, memberId, { ...input, person: 'An' }, t(day));
    if (!result.ok) throw new Error(result.error);
    corpus = result.corpus;
  };
  const ta = 'title-abstract' as const;
  const ft = 'full-text' as const;
  const [a, b, c, d, e, g, i] = [
    id('10.1000/a'),
    id('10.1000/b'),
    id('10.1000/c'),
    id('10.1000/d'),
    titled('Epsilon study'),
    id('10.1000/g'),
    id('10.1000/i'),
  ];
  decide(a, { stage: ta, decision: 'include' }, 2);
  decide(a, { stage: ft, decision: 'include' }, 3);
  // B: included, assessed, then the title-abstract decision was reversed; its full-text entry no longer counts.
  decide(b, { stage: ta, decision: 'include' }, 2);
  decide(b, { stage: ft, decision: 'exclude', reasonCode: 'wrong_design' }, 3);
  decide(b, { stage: ta, decision: 'exclude', reasonCode: 'wrong_topic' }, 4);
  decide(c, { stage: ta, decision: 'include' }, 2);
  decide(d, { stage: ta, decision: 'include' }, 2);
  decide(d, { stage: ft, decision: 'include' }, 3);
  decide(d, { stage: ft, decision: 'exclude', reasonCode: 'wrong_population' }, 4);
  decide(e, { stage: ta, decision: 'uncertain' }, 2);
  decide(g, { stage: ta, decision: 'include' }, 2);
  return {
    ...corpus,
    members: corpus.members.map((m) =>
      m.memberId === c
        ? { ...m, retrieval: 'not_retrieved' as const }
        : m.memberId === i
          ? {
              ...m,
              decisions: [
                {
                  stage: ta,
                  decision: 'exclude' as const,
                  reasonCode: 'wrong_topic',
                  reasonText: '',
                  decider: { kind: 'ai-suggestion' as const },
                  at: t(2),
                },
              ],
            }
          : m,
    ),
  };
}

describe('C3b PRISMA 2020 counts', () => {
  it('C3b PRISMA numbers add up on a hand-checked fixture', () => {
    const counts = prismaCounts(fixture());
    expect(counts.sources).toEqual([
      {
        source: 'openalex',
        kind: 'database',
        totalReported: 10,
        retrieved: 3,
        notExhaustive: true,
        updateRound: 0,
      },
      {
        source: 'scopus.ris',
        kind: 'import',
        totalReported: 4,
        retrieved: 4,
        notExhaustive: false,
        updateRound: 0,
      },
    ]);
    expect(counts).toMatchObject({
      identified: 7,
      identifiedOtherMethods: 0,
      duplicatesRemoved: 2, // A in the RIS file, and H merged into G
      awaitingDuplicateCheck: 1, // "Beta Study" 2021
      recordsOutsideSearches: 3, // G, H and I from the DOI list
      members: 7, // A B C D E G I
      recordsScreened: 6,
      awaitingScreening: 1, // I: only an AI-suggested entry
      excludedTitleAbstract: 1, // B
      uncertainTitleAbstract: 1, // E
      reportsSought: 4, // A C D G
      reportsNotRetrieved: 1, // C
      awaitingFullText: 1, // G
      reportsAssessed: 2, // A D
      reportsExcluded: 1, // D
      uncertainFullText: 0,
      studiesIncluded: 1, // A
    });
    expect(counts.reportsExcludedByReason).toMatchObject({ wrong_population: 1, wrong_design: 0 });
    // Every box is its parent minus its siblings.
    const c = counts;
    expect(c.identified - c.duplicatesRemoved - c.awaitingDuplicateCheck + c.recordsOutsideSearches).toBe(
      c.members,
    );
    expect(c.recordsScreened + c.awaitingScreening).toBe(c.members);
    expect(c.excludedTitleAbstract + c.uncertainTitleAbstract + c.reportsSought).toBe(c.recordsScreened);
    expect(c.reportsNotRetrieved + c.awaitingFullText + c.reportsAssessed).toBe(c.reportsSought);
    expect(c.reportsExcluded + c.uncertainFullText + c.studiesIncluded).toBe(c.reportsAssessed);
    expect(Object.values(c.reportsExcludedByReason).reduce((sum, n) => sum + n, 0)).toBe(c.reportsExcluded);
  });

  it('C3b counts legacy reason codes as other and lists boxes in PRISMA order', () => {
    const corpus = fixture();
    const legacy: Corpus = {
      ...corpus,
      members: corpus.members.map((m) => ({
        ...m,
        decisions: m.decisions.map((d) =>
          d.reasonCode === 'wrong_population' ? { ...d, reasonCode: 'old' } : d,
        ),
      })),
    };
    const boxes = prismaBoxes(prismaCounts(legacy));
    expect(boxes.filter((box) => box.kind === 'reason')).toEqual([
      { column: 'databases', kind: 'reason', code: 'other', n: 1 },
    ]);
    expect(boxes.map((box) => (box.kind === 'box' ? box.key : box.kind)).slice(0, 4)).toEqual([
      'source',
      'source',
      'identified',
      'duplicatesRemoved',
    ]);
    expect(boxes.find((box) => box.column === 'otherMethods')).toMatchObject({
      key: 'identifiedOtherMethods',
      n: 0,
    });
    expect(boxes.at(-1)).toEqual({ column: 'total', kind: 'box', key: 'studiesIncluded', n: 1 });
  });

  it('C3b the screening log lists every decision with its decider', () => {
    const rows = screeningLogRows(fixture());
    expect(rows[0]).toEqual([
      'member',
      'title',
      'stage',
      'decision',
      'reason code',
      'reason text',
      'decider',
      'accepted AI suggestion',
      'at',
    ]);
    expect(rows).toHaveLength(13);
    expect(rows.filter((row) => row[6] === 'ai-suggestion')).toHaveLength(1);
    expect(
      toCsv([
        ['=cmd', 'a,b'],
        ['x', 1],
      ]),
    ).toBe(`'=cmd,"a,b"\nx,1`);
  });
});
