import { describe, expect, it } from 'vitest';
import { compareReference } from './compare';

const record = {
  doi: '10.1234/example',
  title: 'Deep learning',
  container_title: 'Nature',
  authors: ['Yann LeCun'],
  author_count: 1,
  type: 'journal-article',
  volume: '521',
  pages: '436-444',
  issued_year: 2015,
};
const text = 'LeCun Y. Deep learning. Nature 2015;521:436-444';
const output = (
  lookup: 'doi' | 'bibliographic',
  candidate: typeof record & { published_online_year?: number } = record,
) => ({ lookup, status: 'candidates', candidates: [candidate] });
describe('reference comparison', () => {
  it('RA-01 matches bibliographic metadata', () =>
    expect(compareReference(text, 2015, output('bibliographic')).verdict).toBe('matched'));
  it('RA-02 reports DOI author and year discrepancies', () =>
    expect(
      compareReference(text.replace('LeCun', 'Smith'), 2017, output('doi')).mismatches.map((m) => m.field),
    ).toEqual(['first_author', 'year']));
  it('RA-03 reports unregistered DOI', () =>
    expect(
      compareReference(text, 2015, { lookup: 'doi', status: 'not_registered_with_crossref', candidates: [] })
        .verdict,
    ).toBe('not_registered'));
  it('RA-04 leaves unrelated candidates unresolved', () =>
    expect(compareReference('Imaginary results on nothing', 2019, output('bibliographic')).verdict).toBe(
      'unresolved',
    ));
  it('RA-05 ignores diacritics in title and author', () =>
    expect(
      compareReference(
        text,
        2015,
        output('doi', { ...record, title: 'Déep learning', authors: ['Yann LéCun'] }),
      ).verdict,
    ).toBe('matched'));
  it('RA-06 notes a nearby year only when online and print years differ', () => {
    const split = { ...record, issued_year: 2014, published_online_year: 2014, published_print_year: 2015 };
    expect(compareReference(text, 2016, output('doi', split)).notes).toContain('online_first_year');
    const same = { ...record, issued_year: 2015, published_online_year: 2015, published_print_year: 2015 };
    expect(compareReference(text, 2016, output('doi', same)).notes).not.toContain('online_first_year');
  });
  it('RA-07 accepts any publication year', () =>
    expect(
      compareReference(text, 2016, output('doi', { ...record, published_online_year: 2016 })).verdict,
    ).toBe('matched'));
  it('RA-08 skips missing volume', () =>
    expect(compareReference(text, 2015, output('doi', { ...record, volume: '' })).verdict).toBe('matched'));
  it('RA-09 skips journal for book chapters', () =>
    expect(
      compareReference(
        text,
        2015,
        output('doi', { ...record, type: 'book-chapter', container_title: 'Another book' }),
      ).verdict,
    ).toBe('matched'));
  it('RA-10 compares title for DOI lookup', () =>
    expect(
      compareReference(text, 2015, output('doi', { ...record, title: 'Other title' })).mismatches.map(
        (m) => m.field,
      ),
    ).toContain('title'));
  it('RA-11 checks volume and first page', () =>
    expect(
      compareReference(text, 2015, output('doi', { ...record, volume: '10', pages: '20-30' })).mismatches.map(
        (m) => m.field,
      ),
    ).toEqual(['volume', 'pages']));
  it('RA-12 accepts a journal abbreviation', () =>
    expect(
      compareReference(
        text.replace('Nature', 'JMB'),
        2015,
        output('doi', { ...record, container_title: 'Journal of Molecular Biology' }),
      ).verdict,
    ).toBe('matched'));
});
