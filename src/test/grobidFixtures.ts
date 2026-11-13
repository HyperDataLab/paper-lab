import type { GrobidRecord, GrobidResult, Paper } from '@/core/schemas';

const at = '2026-01-01T00:00:00.000Z';
/** Synthetic text only: two body sentences with numbered markers and a two-entry reference section. */
export const grobidPaper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'scan_0001',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'scan_0001.pdf', pageCount: 3, sha256: `sha256:${'a'.repeat(64)}` },
  sections: [
    { id: 'intro', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'refs', heading: 'References', role: 'references', level: 1, pageStart: 3 },
  ],
  paragraphs: [
    {
      id: 'p1',
      sectionId: 'intro',
      order: 0,
      kind: 'body',
      text: 'Prior models were slow [1]. A faster variant exists [9].',
      pageStart: 1,
      textHash: '',
    },
    {
      id: 'r1',
      sectionId: 'refs',
      order: 1,
      kind: 'reference',
      text: '[1] A. Alpha, Slow synthetic models, 2019. [2] B. Beta, Unused synthetic note, 2021.',
      pageStart: 3,
      textHash: '',
    },
  ],
};

export const grobidResult: GrobidResult = {
  version: 'grobid-0.9.0-crf',
  header: {
    title: 'A synthetic header title',
    authors: [
      { forename: 'Ann', surname: 'Lee' },
      { forename: 'Bo', surname: 'Wu' },
    ],
    date: '2024-05-01',
    arxivId: '2401.00001',
    doi: '10.48550/arxiv.2401.00001',
  },
  references: [
    {
      id: 'b0',
      authors: [{ forename: 'A', surname: 'Alpha' }],
      title: 'Slow synthetic models',
      venue: null,
      year: 2019,
      doi: null,
      arxivId: null,
      rawText: null,
    },
    {
      id: 'b1',
      authors: [{ forename: 'B', surname: 'Beta' }],
      title: 'Unused synthetic note',
      venue: null,
      year: 2021,
      doi: '10.1000/XYZ',
      arxivId: null,
      rawText: null,
    },
  ],
  citations: [
    { referenceId: 'b0', text: '[1]', sentence: 'Prior models were slow [1].', page: 1 },
    { referenceId: null, text: '[9]', sentence: 'A faster variant exists [9].', page: 1 },
  ],
};

/** A stored record for `grobidPaper`; with `null` it is a failure with a reason. */
export const grobidRecord = (result: GrobidResult | null = grobidResult): GrobidRecord => ({
  schemaVersion: 3,
  paperId: grobidPaper.id,
  sha256: 'a'.repeat(64),
  version: 'grobid-0.9.0-crf',
  fetchedAt: at,
  status: result ? 'ready' : 'failed',
  error: result ? null : 'kho của lab chưa có PDF của bài này',
  result,
});

/** TEI the worker would return for `grobidPaper`, written by hand. */
export const grobidTei = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
<titleStmt><title>A synthetic header title</title></titleStmt><sourceDesc><biblStruct><analytic>
<author><persName><forename>Ann</forename><surname>Lee</surname></persName></author>
<author><persName><forename>Bo</forename><surname>Wu</surname></persName></author>
</analytic><monogr><imprint><date when="2024-05-01"/></imprint></monogr><idno type="arXiv">arXiv:2401.00001v1[cs.CL]</idno></biblStruct></sourceDesc>
</fileDesc></teiHeader><text><body><p>
<s coords="1,1,1,1,1">Prior models were slow <ref type="bibr" target="#b0">[1]</ref>.</s>
<s coords="1,1,1,1,1">A faster variant exists <ref type="bibr">[9]</ref>.</s></p></body>
<back><listBibl>
<biblStruct xml:id="b0"><analytic><title>Slow synthetic models</title><author><persName><forename>A</forename><surname>Alpha</surname></persName></author></analytic><monogr><imprint><date when="2019"/></imprint></monogr></biblStruct>
<biblStruct xml:id="b1"><analytic><title>Unused synthetic note</title><author><persName><forename>B</forename><surname>Beta</surname></persName></author></analytic><monogr><imprint><date when="2021"/></imprint></monogr><idno type="DOI">10.1000/XYZ</idno></biblStruct>
</listBibl></back></text></TEI>`;
