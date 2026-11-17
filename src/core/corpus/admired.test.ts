import { describe, expect, it } from 'vitest';
import { CorpusMemberSchema, CorpusSchema } from '../schemas/corpus';
import { admiredQuotas, samplingOf, selectAdmired, selectAdmiredControl } from './admired';
import { exampleCorpus } from './contract';
import type { Work } from './sampling';

function work(
  id: string,
  year: number,
  cited: number | null | undefined,
  venue = 'S1',
  doi = `10.1/${id}`,
): Work {
  return {
    id,
    doi,
    title: 'Research',
    publication_year: year,
    type: 'article',
    is_retracted: false,
    primary_location: { source: { id: `https://openalex.org/${venue}` } },
    cited_by_count: cited,
  };
}
const ids = (r: ReturnType<typeof selectAdmired>) => r.sample.map((s) => s.work.id);

describe('P4 admired sampling', () => {
  it('ranks within publication year, so old papers do not take every slot', () => {
    const members = [
      work('old-a', 2020, 900),
      work('old-b', 2020, 800),
      work('old-c', 2020, 700),
      work('new-a', 2024, 30),
      work('new-b', 2024, 10),
      work('new-c', 2024, 20),
    ];
    const result = selectAdmired({ members, n: 4, years: [2020, 2024] });
    expect(ids(result)).toEqual(['old-a', 'old-b', 'new-a', 'new-c']);
    expect(result.sample.map((s) => s.rank)).toEqual([1, 2, 1, 2]);
  });
  it('splits N equally per year, remainder to the earliest years', () => {
    expect([...admiredQuotas({ n: 100, years: [2025, 2020, 2021, 2022, 2023, 2024] })]).toEqual([
      [2020, 17],
      [2021, 17],
      [2022, 17],
      [2023, 17],
      [2024, 16],
      [2025, 16],
    ]);
    expect([...admiredQuotas({ n: 100, years: [2020, 2021], perYear: 30 }).values()]).toEqual([30, 30]);
    const members = Array.from({ length: 60 }, (_, i) => work(`W${i}`, 2020 + (i % 3), i));
    const result = selectAdmired({ members, n: 10, years: [2020, 2021, 2022] });
    expect(result.report.years.map((y) => [y.year, y.target, y.count])).toEqual([
      [2020, 4, 4],
      [2021, 3, 3],
      [2022, 3, 3],
    ]);
  });
  it('reports a short year without refilling it from other years', () => {
    const members = [work('a', 2020, 5), ...Array.from({ length: 10 }, (_, i) => work(`b${i}`, 2021, i))];
    const result = selectAdmired({ members, n: 6, years: [2020, 2021] });
    expect(result.report.years).toEqual([
      { year: 2020, target: 3, count: 1, shortfall: 2, missingCitedBy: 0 },
      { year: 2021, target: 3, count: 3, shortfall: 0, missingCitedBy: 0 },
    ]);
  });
  it('breaks ties by DOI then id, and is deterministic under input order', () => {
    const members = [
      work('W3', 2020, 5, 'S1', 'https://doi.org/10.1/C'),
      work('W1', 2020, 5, 'S1', '10.1/b'),
      work('W2', 2020, 5, 'S1', '10.1/a'),
    ];
    expect(ids(selectAdmired({ members, n: 2, years: [2020] }))).toEqual(['W2', 'W1']);
    expect(selectAdmired({ members: [...members].reverse(), n: 2, years: [2020] })).toEqual(
      selectAdmired({ members, n: 2, years: [2020] }),
    );
  });
  it('ranks a missing citation count after every known count, including zero', () => {
    const members = [work('none', 2020, undefined), work('null', 2020, null), work('zero', 2020, 0)];
    const result = selectAdmired({ members, n: 3, years: [2020] });
    expect(ids(result)).toEqual(['zero', 'none', 'null']);
    expect(result.report.years[0]?.missingCitedBy).toBe(2);
  });
  it('applies the C4a exclusions and one record per id', () => {
    const members = [
      work('W1', 2020, 99),
      work('W1', 2020, 99),
      { ...work('R', 2020, 1000), is_retracted: true },
      { ...work('E', 2020, 1000), title: 'Erratum' },
      work('W2', 2020, 1),
    ];
    const result = selectAdmired({ members, n: 5, years: [2020] });
    expect(ids(result)).toEqual(['W1', 'W2']);
    expect(result.report.exclusions).toEqual({ duplicate: 1, retracted: 1, title: 1 });
  });
  it('selects the control per year to the target counts, ranked per control venue', () => {
    const members = [
      ...Array.from({ length: 5 }, (_, i) => work(`big${i}`, 2020, 1000 + i, 'S10')),
      ...Array.from({ length: 5 }, (_, i) => work(`small${i}`, 2020, i, 'S20')),
      ...Array.from({ length: 5 }, (_, i) => work(`late${i}`, 2021, i, 'S20')),
      work('other', 2020, 5000, 'S99'),
    ];
    const result = selectAdmiredControl({
      members,
      targetPerYear: new Map([
        [2020, 3],
        [2021, 2],
      ]),
      venues: ['S10', 'https://openalex.org/S20'],
    });
    expect(ids(result)).toEqual(['big4', 'big3', 'small4', 'late4']);
    expect(result.report.years.map((y) => [y.year, y.target, y.count, y.shortfall])).toEqual([
      [2020, 3, 3, 0],
      [2021, 2, 1, 1],
    ]);
  });
  it('old protocols and members without the P4 fields still parse', () => {
    const journalBody = {
      venues: [{ name: 'J', issn: [] }],
      years: [2020],
      articleTypes: ['article'],
      versionOfRecordOnly: true,
      samplingRule: '150',
      seed: 's',
      strata: [],
      capPerIssue: null,
      exclusions: [],
    };
    const example = exampleCorpus();
    const corpus = CorpusSchema.parse({
      ...example,
      kind: 'journal',
      protocol: example.protocol.map((p) => ({ ...p, body: journalBody })),
    });
    expect(samplingOf(corpus.protocol.at(-1)?.body)).toEqual({ scope: 'signature' });
    expect(
      CorpusSchema.safeParse({
        ...corpus,
        protocol: [
          { ...corpus.protocol[0], body: { ...journalBody, sampling: { scope: 'admired', n: 100 } } },
        ],
      }).success,
    ).toBe(false);
    const member = corpus.members[0];
    expect(member && 'citedByCount' in member).toBe(false);
    expect(
      CorpusMemberSchema.parse({ ...member, citedByCount: 12, subfieldId: 'subfields/1702' }),
    ).toMatchObject({
      citedByCount: 12,
      subfieldId: 'subfields/1702',
    });
    expect(CorpusMemberSchema.safeParse({ ...member, subfieldId: '1702' }).success).toBe(false);
  });
});
