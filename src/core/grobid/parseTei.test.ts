import { describe, expect, it } from 'vitest';
import { grobidResult, grobidTei } from '@/test/grobidFixtures';
import { parseGrobidTei } from './parseTei';

describe('GROBID TEI', () => {
  it('extracts separate names, identifiers, references and linked citations', () => {
    const result = parseGrobidTei(`<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
      <titleStmt><title>Synthetic study</title></titleStmt><sourceDesc><biblStruct><analytic>
      <author><persName><forename>A</forename><surname>One</surname></persName><persName><forename>B</forename><surname>Two</surname></persName></author>
      </analytic><monogr><imprint><date when="2024-01-02"/></imprint></monogr><idno type="arXiv">arXiv:1234.56789v2[cs.CL]</idno></biblStruct></sourceDesc>
      </fileDesc></teiHeader><text><body><p><s coords="2,1,2,3,4">See <ref type="bibr" target="#b0">[1]</ref>.</s></p></body>
      <back><listBibl><biblStruct xml:id="b0"><analytic><title>Prior work</title><author><persName><surname>Three</surname></persName></author></analytic>
      <monogr><title>Journal</title><imprint><date when="2020"/></imprint></monogr><idno type="DOI">10.1234/example</idno><note type="raw_reference">Synthetic reference.</note></biblStruct></listBibl></back></text></TEI>`);
    expect(result.header).toEqual({
      title: 'Synthetic study',
      authors: [
        { forename: 'A', surname: 'One' },
        { forename: 'B', surname: 'Two' },
      ],
      date: '2024-01-02',
      arxivId: '1234.56789v2',
      doi: '10.48550/arxiv.1234.56789',
    });
    expect(result.references[0]).toEqual({
      id: 'b0',
      authors: [{ forename: '', surname: 'Three' }],
      title: 'Prior work',
      venue: 'Journal',
      year: 2020,
      doi: '10.1234/example',
      arxivId: null,
      rawText: 'Synthetic reference.',
    });
    expect(result.citations).toEqual([{ referenceId: 'b0', text: '[1]', sentence: 'See [1].', page: 2 }]);
  });
  it('keeps a marker GROBID could not link, with no reference id', () => {
    const result = parseGrobidTei(grobidTei);
    expect(result.header.doi).toBe('10.48550/arxiv.2401.00001');
    expect(result.header.arxivId).toBe('2401.00001v1');
    expect(result.citations).toEqual(grobidResult.citations);
    expect(result.references.map((reference) => [reference.id, reference.year, reference.doi])).toEqual([
      ['b0', 2019, null],
      ['b1', 2021, '10.1000/xyz'],
    ]);
  });
  it('rejects invalid XML', () => expect(() => parseGrobidTei('<TEI>')).toThrow());
});
