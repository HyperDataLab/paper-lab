import { describe, expect, it } from 'vitest';
import { examplePaperModel } from './contract';
import { paperModelToJats } from './jats';
import { citationParts } from './jatsCitations';

describe('R17d JATS export', () => {
  it('resolves numeric citations only when all references exist', () => {
    const refs = new Set(['ref3', 'ref4', 'ref5', 'ref7']);
    expect(citationParts('[3–5] [3, 7] [99] [3–7]', refs)).toEqual([
      { text: '' },
      { text: '[3–5]', rids: ['ref3', 'ref4', 'ref5'] },
      { text: ' ' },
      { text: '[3, 7]', rids: ['ref3', 'ref7'] },
      { text: ' [99] [3–7]' },
    ]);
  });

  it('exports metadata, nested sections, blocks, references and citations without mutating the model', () => {
    const model = examplePaperModel();
    model.document.metadata = {
      ...model.document.metadata,
      title: 'A title',
      authors: ['A. Author'],
      affiliations: ['Lab'],
      venue: 'Journal',
      year: 2024,
      doi: '10.1/example',
      volume: '1',
      issue: '2',
      pages: '12–15',
      keywords: ['science'],
    };
    model.document.references = [3, 4, 5].map((n) => ({
      id: `ref${n}`,
      text: `Reference ${n}`,
      year: null,
      doi: n === 3 ? '10.1/ref' : null,
    }));
    const block = model.document.blocks.find((b) => b.sectionId === 'res');
    if (!block) throw new Error('Missing fixture block');
    block.text = 'Evidence [3–5] and [99].';
    const before = structuredClone(model);
    const xml = paperModelToJats(model);
    expect(xml).toContain('<journal-title>Journal</journal-title>');
    expect(xml).toContain('<string-name>A. Author</string-name>');
    expect(xml).toContain('<fpage>12</fpage><lpage>15</lpage>');
    expect(xml).toContain('<sec sec-type="results">');
    expect(xml).toContain('<table-wrap><table><tbody><tr><td>');
    expect(xml).toContain('</td></tr></tbody></table></table-wrap>');
    expect(xml.indexOf('<article-id')).toBeLessThan(xml.indexOf('<title-group>'));
    expect(xml.indexOf('<title-group>')).toBeLessThan(xml.indexOf('<contrib-group>'));
    expect(xml.indexOf('</contrib-group>')).toBeLessThan(xml.indexOf('<aff>'));
    expect(xml.indexOf('</aff>')).toBeLessThan(xml.indexOf('<pub-date>'));
    expect(xml.indexOf('</pub-date>')).toBeLessThan(xml.indexOf('<volume>'));
    expect(xml.indexOf('</lpage>')).toBeLessThan(xml.indexOf('<abstract>'));
    expect(xml.indexOf('</abstract>')).toBeLessThan(xml.indexOf('<kwd-group>'));
    expect(xml).toContain('<xref ref-type="bibr" rid="ref3 ref4 ref5">[3–5]</xref> and [99]');
    expect(xml).toContain(
      '<ref id="ref3"><mixed-citation>Reference 3 <pub-id pub-id-type="doi">10.1/ref</pub-id>',
    );
    expect(model).toEqual(before);
  });

  it('produces well-formed XML for a preprint and arbitrary XML characters', () => {
    const model = examplePaperModel();
    model.document.metadata.title = `A & <tag> "quote" ' \u0000 \ud800`;
    model.document.metadata.doi = null;
    model.document.metadata.venue = null;
    const xml = paperModelToJats(model);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('article-title')?.textContent).toBe(`A & <tag> "quote" '  `);
    expect(doc.querySelector('journal-meta, article-id')).toBeNull();
  });

  it('wraps indexed sentences and nests non-rejected scheme labels', () => {
    const model = examplePaperModel();
    const xml = paperModelToJats(model, { sentences: true });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const sentence = doc.querySelector(
      'named-content[content-type="sentence"] named-content[vocab="paperlab-rhetoric"] named-content[vocab="paperlab-stance"]',
    );
    expect(sentence).not.toBeNull();
    expect(doc.querySelectorAll('named-content:not([content-type])')).toHaveLength(0);
    expect(doc.querySelector('named-content[vocab-term="limitation"]')).toBeNull();
    expect(paperModelToJats(model)).not.toContain('content-type="sentence"');
  });
});
