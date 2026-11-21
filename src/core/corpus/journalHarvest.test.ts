import { describe, expect, it } from 'vitest';
import { newCorpus } from './index';
import {
  addJournalSample,
  admiredControlQuotas,
  admiredHarvestLimit,
  JournalWorkSchema,
} from './journalHarvest';

const at = '2026-01-01T00:00:00.000Z';

describe('journal harvest intake', () => {
  it('records the app metadata on a sought build member and matches its actual year', () => {
    const journal = newCorpus({
      id: 'journal',
      kind: 'journal',
      title: 'Example',
      createdAt: at,
      protocol: [],
    });
    const work = JournalWorkSchema.parse({
      id: 'https://openalex.org/W1',
      doi: 'https://doi.org/10.5555/test',
      title: 'A synthetic work',
      publication_year: 2022,
      type: 'article',
      is_retracted: false,
      biblio: { volume: '2', issue: '3' },
      cited_by_count: 0,
      primary_topic: { subfield: { id: 'https://openalex.org/subfields/123' } },
      authorships: [
        { author: { id: 'A1' }, institutions: [{ country_code: 'VN' }, { country_code: null }] },
        { author: { id: 'A1' }, institutions: [{ country_code: 'VN' }] },
      ],
    });
    const target = addJournalSample(journal, [{ work, role: 'build' }], at);
    expect(target.members).toHaveLength(1);
    expect(target.members[0]).toMatchObject({
      role: 'build',
      version: 'publishedVersion',
      retrieval: 'sought',
      textRead: 'METADATA_ONLY',
      identifiers: { doi: '10.5555/test', openalexId: 'W1' },
      stratum: { year: 2022, articleType: 'article', issue: '2/3' },
      authorIds: ['A1'],
      countries: ['VN'],
      citedByCount: 0,
      subfieldId: 'subfields/123',
      decisions: [],
    });
    expect([...admiredControlQuotas(target, [2021, 2022])]).toEqual([
      [2021, 0],
      [2022, 1],
    ]);
  });

  it('uses the app buffer per venue and skips years with a zero quota', () => {
    expect(admiredHarvestLimit(10, 1)).toBe(30);
    expect(admiredHarvestLimit(10, 3)).toBe(20);
    expect(admiredHarvestLimit(0, 3)).toBe(0);
  });
});
