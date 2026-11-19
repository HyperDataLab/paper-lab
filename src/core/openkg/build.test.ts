import { expect, it } from 'vitest';
import { mapOpenAlex, mergeLookups } from '../library';
import { buildPaperModel } from '../paperModel';
import { ArgumentRunSchema, LibraryItemSchema, PaperSchema, ScgPaperRunSchema } from '../schemas';
import { buildPaperKg, KG_LAYERS, kgIri } from './index';

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-01-01T00:00:00.000Z';
const paper = PaperSchema.parse({
  schemaVersion: 1,
  id,
  title: 'Synthetic study',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'paper.txt', sha256: '', pageCount: null },
  sections: [
    { id: 's1', heading: 'Results', role: 'results', level: 1, pageStart: null },
    { id: 's2', heading: 'References', role: 'references', level: 1, pageStart: null },
  ],
  paragraphs: [
    {
      id: 'p1',
      sectionId: 's1',
      order: 0,
      text: 'Δ rose. We observed two runs.',
      pageStart: null,
      kind: 'body',
      textHash: '',
    },
    {
      id: 'p2',
      sectionId: 's2',
      order: 1,
      text: '[1] B. Test. 2020. doi:10.1000/TEST',
      pageStart: null,
      kind: 'reference',
      textHash: '',
    },
  ],
});
const model = buildPaperModel({ paper, metadata: null, now: new Date(at) });
const claim = { paragraphId: 'p1', sectionId: 's1', page: null, start: 0, end: 7, excerpt: 'Δ rose.' };
const data = { ...claim, start: 8, end: 29, excerpt: 'We observed two runs.' };
const keys = model.sentences.map((sentence) => sentence.key);

const openalex = mapOpenAlex({
  id: 'https://openalex.org/W1',
  primary_location: { source: { id: 'S1', display_name: 'Journal of Tests' } },
  referenced_works: ['W2'],
  keywords: [0.6, 0.599, 0.4, 0.399].map((score, index) => ({
    id: `keywords/term-${index}`,
    display_name: `Term ${index}`,
    score,
  })),
  primary_topic: {
    id: 'topics/T1',
    display_name: 'Test topic',
    subfield: { id: 'subfields/1', display_name: 'Test subfield' },
    field: { id: 'fields/1', display_name: 'Test field' },
    domain: { id: 'domains/1', display_name: 'Test domain' },
  },
  authorships: [
    {
      author: { id: 'A1', orcid: '0000-0002-1825-0097', display_name: 'A. Test' },
      institutions: [{ display_name: 'Test Institute', ror: '03yrm5c26', country_code: 'VN' }],
    },
    { author: { id: 'A2', display_name: 'B. Test' } },
  ],
});
const library = LibraryItemSchema.parse({
  ...mergeLookups({ openalex, crossref: null, oa: [], incomplete: false }),
  schemaVersion: 1,
  id,
  doi: '10.1000/synthetic',
  addedAt: at,
  updatedAt: at,
  lookup: 'done',
  paper_id: id,
  file_matches_title: true,
  error: null,
});
const prerequisite = {
  id: 'W1.c0.p0',
  name: 'Prior baseline',
  description: '',
  explanation: '',
  coreOrPeripheral: 'core',
  review: 'candidate',
  sourceSentenceKeys: keys,
  references: [
    { kind: 'paper', refId: 'ref1', title: 'Test', year: 2020, doi: '10.1000/test', s2CorpusId: null },
    { kind: 'contribution', contributionId: 'W1.c1' },
  ],
  matches: [
    { contributionId: 'W9.c0', explanation: '', matchType: 'strong', review: 'accepted' },
    { contributionId: 'W9.c1', explanation: '', matchType: 'weak', review: 'rejected' },
  ],
};
const contribution = {
  id: 'W1.c0',
  name: 'Synthetic result',
  description: '',
  review: 'accepted',
  types: [{ type: 'analysis', explanation: '' }],
  sections: ['Results'],
  sourceSentenceKeys: keys,
  prerequisites: [prerequisite, { ...prerequisite, id: 'W1.c0.p1', review: 'rejected' }],
};
const scgRun = ScgPaperRunSchema.parse({
  schemaVersion: 1,
  paperId: id,
  doi: null,
  s2CorpusId: null,
  s2CheckedAt: null,
  idBase: 'W1',
  promptVersion: 'test',
  promptVersions: { contributions: 'test', prerequisites: 'test', alignment: 'test' },
  requestedModel: 'test',
  model: 'test',
  status: 'complete',
  callsUsed: 0,
  dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
  contributions: [contribution, { ...contribution, id: 'W1.c1', review: 'rejected', prerequisites: [] }],
  progress: { fingerprint: '', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
  reviewCarry: {},
  createdAt: at,
  updatedAt: at,
});
const argumentRun = ArgumentRunSchema.parse({
  id,
  createdAt: at,
  model: 'test',
  promptVersion: 'test',
  callsUsed: 0,
  sectionIds: ['s1'],
  failedSectionIds: [],
  arguments: [
    {
      id: 'arg-1',
      importance: 'main',
      claim,
      data: [data],
      statedWarrant: null,
      inferredWarrant: null,
      backing: [],
      qualifier: null,
      rebuttals: [],
      evidenceLevel: 'E2',
      evidenceBasis: 'Two observations',
    },
  ],
  discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
});

it('builds five layers from existing records with stable identities and grounded evidence', () => {
  const input = { paper, model, library, scgRun, argumentRun };
  const kg = buildPaperKg(input);
  const nodes = new Map(kg.nodes.map((node) => [node.id, node]));
  expect(buildPaperKg(input)).toEqual(kg);
  expect([...new Set(kg.nodes.map((node) => node.layer))].sort()).toEqual([...KG_LAYERS].sort());
  expect(kg.edges.every((edge) => nodes.has(edge.s) && nodes.has(edge.o))).toBe(true);
  expect(kg.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ p: 'cites', o: kgIri('work', 'W2'), provenance: 'openalex' }),
      expect.objectContaining({ p: 'cites', o: kgIri('work', '10.1000/test'), provenance: 'paper_text' }),
      expect.objectContaining({ p: 'publishedIn', o: kgIri('source', 'S1'), provenance: 'openalex' }),
      expect.objectContaining({
        p: 'inTopic',
        o: kgIri('discipline', 'topics', 'T1'),
        provenance: 'openalex',
      }),
      expect.objectContaining({
        p: 'broader',
        s: kgIri('discipline', 'topics', 'T1'),
        o: kgIri('discipline', 'subfields', '1'),
      }),
      expect.objectContaining({ p: 'authoredBy', o: kgIri('author', 'A2'), provenance: 'openalex' }),
      expect.objectContaining({
        p: 'affiliatedWith',
        s: kgIri('author', '0000-0002-1825-0097'),
        o: kgIri('institution', '03yrm5c26'),
      }),
      expect.objectContaining({
        p: 'contributes',
        o: kgIri('contribution', 'W1.c0'),
        provenance: 'accepted',
        evidence: keys,
      }),
      expect.objectContaining({
        p: 'buildsOn',
        o: kgIri('prerequisite', 'W1.c0.p0'),
        provenance: 'llm_candidate',
        evidence: keys,
      }),
      expect.objectContaining({
        p: 'buildsOn',
        o: kgIri('work', '10.1000/test'),
        provenance: 'llm_candidate',
      }),
      expect.objectContaining({ p: 'buildsOn', o: kgIri('contribution', 'W9.c0'), provenance: 'accepted' }),
      expect.objectContaining({ p: 'supportedBy', provenance: 'llm_candidate', evidence: keys.slice(1) }),
      expect.objectContaining({
        p: 'evidenceLevel',
        o: kgIri('evidence-level', 'E2'),
        provenance: 'llm_candidate',
        evidence: keys.slice(0, 1),
      }),
    ]),
  );
  expect(nodes.get(kgIri('institution', '03yrm5c26'))?.attrs.country).toBe('VN');
  expect(kg.nodes.filter((node) => node.type === 'Keyword').map((node) => node.attrs.salience)).toEqual([
    'high',
    'middle',
    'middle',
    'low',
  ]);
  for (const rejected of ['contribution/W1.c1', 'contribution/W9.c1', 'prerequisite/W1.c0.p1']) {
    expect(nodes.has(kgIri(...rejected.split('/')))).toBe(false);
  }
});

it('keeps text references without lookup and suppresses moved argument spans', () => {
  const stale = {
    ...paper,
    paragraphs: paper.paragraphs.map((p) => (p.id === 'p1' ? { ...p, text: 'A different sentence.' } : p)),
  };
  const kg = buildPaperKg({ paper: stale, argumentRun });
  expect(kg.nodes.map((node) => node.type)).toEqual(['Paper', 'Work']);
  expect(kg.edges).toHaveLength(1);
  expect(kg.edges[0]).toMatchObject({ p: 'cites', provenance: 'paper_text' });
});

it('links a uniquely resolved citation to its sentence and leaves ambiguous citations unlinked', () => {
  const [body, reference] = paper.paragraphs;
  if (!body || !reference) throw new Error('Test paper requires a body and bibliography');
  const citing = {
    ...paper,
    paragraphs: [{ ...body, text: 'A previous study [1] tracked this.' }, reference],
  };
  const citedModel = buildPaperModel({ paper: citing, metadata: null, now: new Date(at) });
  expect(citedModel.sentences).toHaveLength(1);
  expect(buildPaperKg({ paper: citing, model: citedModel }).edges[0]).toMatchObject({
    provenance: 'paper_text',
    evidence: citedModel.sentences.map(({ key }) => key),
  });
  const ambiguous = {
    ...citing,
    paragraphs: [
      ...citing.paragraphs,
      { ...reference, id: 'p3', order: 2, text: '[1] A different test. doi:10.1000/OTHER' },
    ],
  };
  const graph = buildPaperKg({ paper: ambiguous });
  expect(graph.edges).toHaveLength(2);
  expect(graph.edges.every((edge) => edge.evidence === undefined)).toBe(true);
});
