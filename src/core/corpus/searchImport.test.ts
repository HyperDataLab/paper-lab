import { describe, expect, it } from 'vitest';
import { newCorpus } from './index';
import { addFromDois } from './intake';
import { parseCsv, parseRis, parseSearchFile, recordImport } from './searchImport';

const at = '2026-01-01T00:00:00.000Z';
const BOM = String.fromCharCode(0xfeff);
const empty = () =>
  newCorpus({
    id: 'imp',
    kind: 'topic',
    title: 'Synthetic',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: { researchQuestion: 'Q?', inclusion: [], exclusion: [], years: [] },
      },
    ],
  });

describe('C3b search file import', () => {
  it('C3b parses RIS with T1/A1/Y1 variants, CRLF, a BOM, URL DOIs and a missing last ER', () => {
    const text =
      BOM +
      'TY  - JOUR\r\nTI  - Synthetic record one\r\nAU  - Doe, A.\r\nAU  - Roe, B.\r\nPY  - 2020/05/01/\r\n' +
      'DO  - https://doi.org/10.1000/ONE\r\nJO  - Journal of Synthetic Tests\r\nER  -\r\n' +
      'TY  - CHAP\r\nT1  - Synthetic record two\r\n  continued\r\nA1  - Poe, C.\r\nY1  - 2019\r\nT2  - Synthetic Book\r\nER  - \r\n' +
      'TY  - JOUR\r\nAU  - Nobody\r\nER  -\r\n' +
      'TY  - JOUR\r\nDO  - 10.1000/three\r\n';
    expect(parseRis(text)).toEqual({
      format: 'ris',
      skipped: 1,
      records: [
        {
          title: 'Synthetic record one',
          authors: ['Doe, A.', 'Roe, B.'],
          year: 2020,
          doi: '10.1000/one',
          journal: 'Journal of Synthetic Tests',
        },
        {
          title: 'Synthetic record two continued',
          authors: ['Poe, C.'],
          year: 2019,
          doi: null,
          journal: 'Synthetic Book',
        },
        { title: null, authors: [], year: null, doi: '10.1000/three', journal: null },
      ],
    });
  });

  it('C3b parses CSV with case-insensitive header variants and quoted fields', () => {
    const text =
      BOM +
      'Authors,Article Title,Source Title,Publication Year,DOI\n' +
      '"Doe, A.; Roe, B.","Synthetic, quoted ""record""",Synthetic Journal,2021,10.1000/csv1\r\n' +
      'Poe C.,"Two-line\ntitle",,2018,\n' +
      ',,,,\n' +
      'Nobody,,,2020,\n';
    expect(parseCsv(text)).toEqual({
      format: 'csv',
      skipped: 1,
      records: [
        {
          title: 'Synthetic, quoted "record"',
          authors: ['Doe, A.', 'Roe, B.'],
          year: 2021,
          doi: '10.1000/csv1',
          journal: 'Synthetic Journal',
        },
        { title: 'Two-line\ntitle', authors: ['Poe C.'], year: 2018, doi: null, journal: null },
      ],
    });
    expect(parseCsv('title,year,doi\nA synthetic title,2020,doi:10.1000/x').records[0]).toMatchObject({
      title: 'A synthetic title',
      doi: '10.1000/x',
    });
    expect(parseSearchFile('export.txt', 'TY  - JOUR\nTI  - X\nER  -').format).toBe('ris');
    expect(parseSearchFile('export.csv', 'title\nX').format).toBe('csv');
  });

  it('C3b an import creates a search entry and deduplicates against existing members', () => {
    const start = addFromDois(empty(), '10.1000/old', { now: at }).corpus;
    const parsed = parseCsv(
      'Title,Year,DOI\nOld synthetic record,2020,https://doi.org/10.1000/OLD\nNew synthetic record,2021,10.1000/new\n' +
        'New Synthetic Record,2021,\n',
    );
    const result = recordImport(start, 'wos.csv', parsed, at);
    expect(result).toMatchObject({ added: 1, duplicates: 1, pending: 1, skipped: 0 });
    expect(result.corpus.members).toHaveLength(2);
    expect(result.corpus.members[0]?.title).toBe('Old synthetic record');
    expect(result.corpus.pendingConfirmations).toHaveLength(1);
    expect(result.corpus.searches).toEqual([
      { fileName: 'wos.csv', format: 'csv', records: 3, added: 1, duplicates: 1, runAt: at },
    ]);
  });
});
