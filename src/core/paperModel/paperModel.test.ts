import { describe, expect, it } from 'vitest';
import { PaperModelSchema, type Paper, type PaperMetadata, type PaperModelAnnotation } from '../schemas';
import {
  buildPaperModel,
  fnv1a64,
  normalizeSentence,
  reanchor,
  sectionTree,
  SENTENCE_KEY_VERSION,
  sentenceIndex,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const now = new Date('2026-11-11T00:00:00.000Z');

function makePaper(prefix = 'pg1'): Paper {
  const p = (
    id: string,
    sectionId: string,
    kind: Paper['paragraphs'][number]['kind'],
    text: string,
    order: number,
  ) => ({ id: `${prefix}_${id}`, sectionId, order, kind, text, pageStart: 1, textHash: `h-${id}` });
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    title: 'A Parsed Title',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 3, sha256: 'x', parserVersion: 'pdf-1' },
    sections: [
      { id: 'abs', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
      { id: 'intro', heading: '1 Introduction', role: 'introduction', level: 1, pageStart: 1 },
      { id: 'deep', heading: '1.1.1 Detail', role: 'introduction', level: 3, pageStart: 1 },
      { id: 'mid', heading: '1.2 Middle', role: 'introduction', level: 2, pageStart: 2 },
      { id: 'refs', heading: 'References', role: 'references', level: 1, pageStart: 3 },
    ],
    paragraphs: [
      p('a1', 'abs', 'body', 'We study keys. They must be stable.', 0),
      p('a2', 'abs', 'list', 'A listed abstract point.', 1),
      p('i1', 'intro', 'body', 'Results matter. We study keys.', 2),
      p('i2', 'intro', 'table', 'Col A Col B. 1 2.', 3),
      p('i3', 'intro', 'equation', 'E = mc2.', 4),
      p('i4', 'intro', 'caption', 'Figure 1. A caption sentence.', 5),
      p('i5', 'intro', 'footnote', 'A footnote outside the abstract.', 6),
      p('i6', 'intro', 'heading_like', 'Looks like a heading.', 7),
      p('r1', 'refs', 'reference', '[1] A. Author. Some paper. J. Things, 2019. doi:10.1000/xyz1', 8),
      p('r2', 'refs', 'reference', '[2] B. Author. Other paper. Proc. Stuff, 2021.', 9),
    ],
  };
}

describe('R17a sentence keys', () => {
  it('normalises NFKC, soft hyphens, case and whitespace', () => {
    expect(normalizeSentence('  The ﬁrst  ana­lysis\nWorks. ')).toBe('the first analysis works.');
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(SENTENCE_KEY_VERSION).toMatch(/^pl-skey-/u);
  });
  it('keys do not change when paragraph ids change', () => {
    const a = sentenceIndex(makePaper('pg1'));
    const b = sentenceIndex(makePaper('pg9'));
    expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key));
    expect(a.map((s) => s.displayId)).not.toEqual(b.map((s) => s.displayId));
    expect(a[0]?.displayId).toBe('pg1_a1_s1');
  });
  it('duplicate sentences get #1 and #2 in reading order', () => {
    const keys = sentenceIndex(makePaper()).filter((s) => s.text === 'We study keys.');
    expect(keys).toHaveLength(2);
    expect(keys[0]?.key.endsWith('#1')).toBe(true);
    expect(keys[1]?.key.endsWith('#2')).toBe(true);
    expect(keys[0]?.key.split('#')[0]).toBe(keys[1]?.key.split('#')[0]);
  });
  it('indexes body, caption and the abstract; not references, tables, equations or headings', () => {
    const sentences = sentenceIndex(makePaper());
    const paragraphs = new Set(sentences.map((s) => s.paragraphId.replace('pg1_', '')));
    expect([...paragraphs]).toEqual(['a1', 'a2', 'i1', 'i4']);
    expect(sentences.map((s) => s.text)).toEqual([
      'We study keys.',
      'They must be stable.',
      'A listed abstract point.',
      'Results matter.',
      'We study keys.',
      'Figure 1.',
      'A caption sentence.',
    ]);
  });
  it('offsets are code points', () => {
    const paper = makePaper();
    paper.paragraphs = [{ ...paper.paragraphs[2]!, text: '👩‍🔬 Emoji first. Then this.' }];
    // The emoji is three code points (ZWJ sequence) but five UTF-16 units.
    const [first, second] = sentenceIndex(paper);
    expect(first?.text).toBe('👩‍🔬 Emoji first.');
    expect(second).toMatchObject({ text: 'Then this.', start: 17, end: 27 });
  });
});

describe('R17a paper model', () => {
  it('derives parentId from level, including a level skip', () => {
    expect(sectionTree(makePaper()).map((s) => [s.id, s.parentId])).toEqual([
      ['abs', null],
      ['intro', null],
      ['deep', 'intro'],
      ['mid', 'intro'],
      ['refs', null],
    ]);
  });
  it('builds a valid model from the parsed paper when there is no metadata', () => {
    const model = buildPaperModel({ paper: makePaper(), metadata: null, now });
    expect(model.generatedAt).toBe(now.toISOString());
    expect(model.generator).toMatchObject({
      app: 'PaperLab',
      segmenterVersion: 'pl-seg-3',
      parserVersion: 'pdf-1',
    });
    expect(model.document.metadata).toMatchObject({
      title: 'A Parsed Title',
      source: 'parsed',
      authors: [],
      abstract: 'We study keys. They must be stable.',
    });
    expect(model.document.references.map((r) => [r.id, r.year, r.doi])).toEqual([
      ['ref1', 2019, '10.1000/xyz1'],
      ['ref2', 2021, null],
    ]);
    expect(model.document.blocks).toHaveLength(10);
    expect(model.sentences).toHaveLength(7);
    expect(PaperModelSchema.parse(JSON.parse(JSON.stringify(model)))).toEqual(model);
  });
  it('uses the stored metadata when there is some', () => {
    const metadata: PaperMetadata = {
      source: 'manual',
      fetchedAt: at,
      doi: '10.1/abc',
      title: 'Edited Title',
      type: null,
      year: 2024,
      authors: ['Ann Lee', 'Bo Wu'],
      affiliations: ['Lab'],
      keywords: ['keys'],
      venue: 'Venue',
      volume: '3',
      issue: null,
      pages: '1–9',
      citedBy: null,
      topic: null,
    };
    const model = buildPaperModel({ paper: makePaper(), metadata, now });
    expect(model.document.metadata).toMatchObject({
      title: 'Edited Title',
      source: 'manual',
      authors: ['Ann Lee', 'Bo Wu'],
      keywords: ['keys'],
      year: 2024,
      doi: '10.1/abc',
    });
  });
  it('re-anchors annotations by key and counts the dropped ones', () => {
    const oldModel = buildPaperModel({ paper: makePaper('pg1'), metadata: null, now });
    const label = (key: string): PaperModelAnnotation => ({
      key,
      scheme: 'coresc',
      label: 'Result',
      attrs: { novelty: 'New' },
      span: null,
      text: '',
      origin: 'ai',
      state: 'machine',
      source: { runId: 'run-1', model: 'm', promptVersion: 'p1' },
      second: null,
    });
    const kept = oldModel.sentences[3]!.key;
    oldModel.annotations = [label(kept), label('0000000000000000#1')];
    const changed = makePaper('pg2');
    changed.paragraphs = changed.paragraphs.filter((p) => !p.id.endsWith('a1'));
    const newModel = buildPaperModel({ paper: changed, metadata: null, now });
    const result = reanchor(oldModel, newModel);
    expect(result.dropped).toBe(1);
    expect(result.sameFile).toBe(oldModel.document.source.sha256 !== null);
    expect(result.annotations.map((a) => a.key)).toEqual([kept]);
    // The surviving "We study keys." is now the first occurrence, so its key moved to #1.
    expect(newModel.sentences.find((s) => s.text === 'We study keys.')?.key.endsWith('#1')).toBe(true);
  });
});
