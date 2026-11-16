import { describe, expect, it } from 'vitest';
import { grobidPaper, grobidRecord } from '@/test/grobidFixtures';
import { parseGrobidTei } from '../grobid/parseTei';
import { GrobidRecordSchema } from '../schemas/grobid';
import { runPaperChecks } from './index';

function sample(last: number) {
  const xml = `<TEI><text><body><p><s>Markers <ref type="bibr">[1]</ref> and <ref type="bibr">[${last}]</ref>.</s></p>
    <figure><label>Fig. 1</label></figure><figure><head>Fig. ${last} Example</head></figure>
    <figure type="table"><label>Table 1</label></figure><figure type="table"><head>Table ${last} Example</head></figure>
    </body><back><listBibl><biblStruct xml:id="b1"><label>[1]</label></biblStruct>
    <biblStruct xml:id="b2"><label>[${last}]</label></biblStruct></listBibl></back></text></TEI>`;
  const paper = structuredClone(grobidPaper);
  const body = paper.paragraphs[0];
  const references = paper.paragraphs[1];
  if (!body || !references) throw new Error('Missing synthetic paragraphs');
  body.text = `Markers [1] and [${last}]. Fig. 1. Fig. ${last} Example. Table 1. Table ${last} Example.`;
  references.text = `[1] First reference. [${last}] Last reference.`;
  return { grobid: parseGrobidTei(xml), paper };
}

describe('GROBID numbering gaps', () => {
  it('reports reference, figure and table gaps from synthetic TEI', () => {
    const { paper, grobid } = sample(3);
    expect(grobid.figures).toEqual([
      { type: 'figure', label: 'Fig. 1' },
      { type: 'figure', label: 'Fig. 3 Example' },
      { type: 'table', label: 'Table 1' },
      { type: 'table', label: 'Table 3 Example' },
    ]);
    const report = runPaperChecks(paper, new Date(), grobid);
    const ids = report.checks.flatMap((check) => check.findings.map((item) => item.id));
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gap:grobid:reference:2'),
        expect.stringContaining('gap:grobid:figure:2'),
        expect.stringContaining('gap:grobid:table:2'),
      ]),
    );
  });
  it('does not report gaps in continuous numbering', () => {
    const { paper, grobid } = sample(2);
    const report = runPaperChecks(paper, new Date(), grobid);
    expect(
      report.checks.flatMap((check) => check.findings).filter((item) => item.id.includes('gap:grobid:')),
    ).toEqual([]);
  });
  it('uses joined PDF entries when GROBID omits a reference label', () => {
    const { paper, grobid } = sample(3);
    const references = paper.paragraphs[1];
    if (!references) throw new Error('Missing synthetic references');
    references.text = '1. Alpha, A.: First. 2. Beta, B.: Second. 3. Gamma, C.: Third.';
    const check = runPaperChecks(paper, new Date(), grobid).checks.find(
      (item) => item.id === 'citations_references',
    );
    expect(check?.findings.some((item) => item.id.includes('gap:grobid:reference:'))).toBe(false);
  });
  it('detects gaps from bibliography labels and citations independently', () => {
    const { paper, grobid } = sample(3);
    const listedOnly = { ...grobid, citations: [] };
    const citedOnly = { ...grobid, references: grobid.references.map(({ label: _label, ...item }) => item) };
    for (const input of [listedOnly, citedOnly]) {
      const check = runPaperChecks(paper, new Date(), input).checks.find(
        (item) => item.id === 'citations_references',
      );
      expect(check?.findings.some((item) => item.id.includes('gap:grobid:reference:2'))).toBe(true);
    }
  });
  it('accepts existing version 3 records without figure or reference labels', () => {
    expect(GrobidRecordSchema.safeParse(grobidRecord()).success).toBe(true);
  });
});
