import { describe, expect, it } from 'vitest';
import type { ExtractionProject, Paper, ProjectField, ProjectPaper } from '../schemas';
import {
  catalogField,
  cellCounts,
  cellsFromOutput,
  estimateCalls,
  extractionSource,
  FIELD_CATALOG,
  FIELD_TEMPLATES,
  fieldBatches,
  insufficientCells,
  isStale,
  matrixCsv,
  matrixJson,
  mergeCells,
  reviewCell,
} from './index';

const at = '2026-01-01T00:00:00.000Z';
const RUN = '00000000-0000-4000-8000-000000000002';
const field = (key: string, version = 1): ProjectField => ({
  ...(catalogField(key) as ProjectField),
  version,
  hidden: false,
});
const projectPaper = (
  key: string,
  access: ProjectPaper['access'],
  abstract: string | null = null,
): ProjectPaper => ({
  key,
  source: { kind: 'paper', paperId: '00000000-0000-4000-8000-000000000001' },
  title: `Paper ${key}`,
  authors: [],
  year: 2024,
  venue: null,
  doi: null,
  access,
  abstract,
  revision: 'r1',
  screening: 'included',
});
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 3, sha256: 'x' },
  sections: [
    { id: 'i', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'a', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
    { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: 3 },
  ],
  paragraphs: [
    {
      id: 'p1',
      sectionId: 'i',
      order: 0,
      text: 'We study 120 nurses in Hanoi.',
      kind: 'body',
      textHash: 'a',
      pageStart: 1,
    },
    {
      id: 'p2',
      sectionId: 'a',
      order: 1,
      text: 'Accuracy rose to 91%.',
      kind: 'body',
      textHash: 'b',
      pageStart: 1,
    },
    { id: 'p3', sectionId: 'r', order: 2, text: 'Ref.', kind: 'body', textHash: 'c', pageStart: 3 },
  ],
};
const context = (access: ProjectPaper['access'] = 'FULL_TEXT') => ({
  paper: projectPaper('k', access),
  runId: RUN,
  mode: 'STANDARD' as const,
  at,
});

describe('extraction catalog', () => {
  it('offers 50 distinct fields and templates built from them', () => {
    expect(FIELD_CATALOG).toHaveLength(50);
    expect(new Set(FIELD_CATALOG.map((item) => item.key)).size).toBe(50);
    for (const template of FIELD_TEMPLATES)
      for (const key of template.keys) expect(catalogField(key)).toBeDefined();
  });
});

describe('extraction', () => {
  it('reads prose in reading order, never references, and only the abstract when that is all there is', () => {
    expect(extractionSource(projectPaper('k', 'FULL_TEXT'), paper).map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ]);
    expect(extractionSource(projectPaper('k', 'ABSTRACT_ONLY', 'An abstract.'), undefined)).toEqual([
      { id: 'abstract', text: 'An abstract.', section: 'Abstract', page: null },
    ]);
    expect(extractionSource(projectPaper('k', 'ABSTRACT_ONLY'), undefined)).toEqual([]);
    expect(extractionSource(projectPaper('k', 'FULL_TEXT'), undefined)).toEqual([]);
  });
  it('batches fields and estimates only readable papers', () => {
    expect(fieldBatches(Array.from({ length: 25 }, (_, i) => i)).map((batch) => batch.length)).toEqual([
      12, 12, 1,
    ]);
    const project = {
      papers: [projectPaper('a', 'FULL_TEXT'), projectPaper('b', 'METADATA_ONLY')],
    } as ExtractionProject;
    expect(
      estimateCalls(
        project,
        ['a', 'b'],
        Array.from({ length: 13 }, (_, i) => `f${i}`),
      ),
    ).toBe(2);
  });
  const source = extractionSource(projectPaper('k', 'FULL_TEXT'), paper);
  const fields = ['population_sample', 'results', 'dataset', 'limitations', 'objectives', 'tldr'].map((key) =>
    field(key),
  );
  it('shows a value only with evidence that contains its numbers, and never guesses a missing one', () => {
    const cells = cellsFromOutput(
      {
        fields: [
          {
            field_key: 'population_sample',
            status: 'found',
            value: '120 nurses',
            inferred: false,
            evidence: [{ paragraphId: 'p1', quote: '120 nurses' }],
          },
          {
            field_key: 'results',
            status: 'found',
            value: 'Accuracy 95%',
            inferred: false,
            evidence: [{ paragraphId: 'p2', quote: 'Accuracy rose to 91%' }],
          },
          {
            field_key: 'dataset',
            status: 'found',
            value: 'ImageNet',
            inferred: false,
            evidence: [{ paragraphId: 'p1', quote: 'not in the text' }],
          },
          { field_key: 'limitations', status: 'not_found', value: null, inferred: false, evidence: [] },
          {
            field_key: 'objectives',
            status: 'found',
            value: 'Study nurses',
            inferred: true,
            evidence: [{ paragraphId: 'p1', quote: 'We study' }],
          },
        ],
      },
      fields,
      source,
      context(),
    );
    const by = (key: string) => cells.find((item) => item.fieldKey === key);
    expect(by('population_sample')).toMatchObject({
      status: 'EXTRACTED',
      value: '120 nurses',
      assertion: 'AUTHOR_REPORTED',
    });
    expect(by('population_sample')?.evidence[0]).toMatchObject({
      paragraphId: 'p1',
      page: 1,
      section: 'Introduction',
    });
    expect(by('results')).toMatchObject({ status: 'NEEDS_REVIEW', value: null, aiValue: 'Accuracy 95%' });
    expect(by('results')?.flags).toContain('NUMBER_NOT_IN_EVIDENCE');
    expect(by('dataset')).toMatchObject({ status: 'NEEDS_REVIEW', value: null });
    expect(by('dataset')?.flags).toEqual(expect.arrayContaining(['UNSUPPORTED', 'EVIDENCE_NOT_FOUND']));
    expect(by('limitations')).toMatchObject({ status: 'NOT_FOUND', value: null });
    expect(by('objectives')).toMatchObject({
      status: 'NEEDS_REVIEW',
      value: 'Study nurses',
      assertion: 'INFERRED',
    });
    expect(by('tldr')).toMatchObject({ status: 'FAILED', flags: ['MISSING_IN_OUTPUT'] });
  });
  it('tells abstract-only gaps apart from full-text gaps', () => {
    const abstractSource = extractionSource(
      projectPaper('k', 'ABSTRACT_ONLY', 'We found 3 effects.'),
      undefined,
    );
    const cells = cellsFromOutput(
      {
        fields: [
          {
            field_key: 'results',
            status: 'found',
            value: '3 effects',
            inferred: false,
            evidence: [{ paragraphId: 'abstract', quote: '3 effects' }],
          },
          { field_key: 'dataset', status: 'not_found', value: null, inferred: false, evidence: [] },
          { field_key: 'limitations', status: 'not_applicable', value: null, inferred: false, evidence: [] },
        ],
      },
      fields.slice(1, 4),
      abstractSource,
      context('ABSTRACT_ONLY'),
    );
    expect(cells[0]).toMatchObject({ status: 'EXTRACTED', sourceAccess: 'ABSTRACT_ONLY' });
    expect(cells[0]?.evidence[0]?.paragraphId).toBeNull();
    expect(cells[0]?.flags).toContain('ABSTRACT_ONLY');
    expect(cells[1]?.status).toBe('INSUFFICIENT_SOURCE');
    expect(cells[2]?.status).toBe('NOT_APPLICABLE');
    expect(insufficientCells(fields.slice(0, 1), context('METADATA_ONLY'))[0]).toMatchObject({
      status: 'INSUFFICIENT_SOURCE',
      flags: ['METADATA_ONLY'],
    });
  });
  const base = cellsFromOutput(
    {
      fields: [
        {
          field_key: 'results',
          status: 'found',
          value: 'Accuracy 91%',
          inferred: false,
          evidence: [{ paragraphId: 'p2', quote: 'Accuracy rose to 91%' }],
        },
      ],
    },
    [field('results')],
    source,
    context(),
  )[0];
  if (!base) throw new Error('missing cell');
  it('keeps the model value through every review and can undo', () => {
    const approved = reviewCell(base, 'approve', at);
    expect(approved).toMatchObject({ status: 'VERIFIED', verification: 'HUMAN', value: 'Accuracy 91%' });
    const edited = reviewCell(base, 'edit', at, ' 91% accuracy ');
    expect(edited).toMatchObject({ status: 'VERIFIED', value: '91% accuracy', aiValue: 'Accuracy 91%' });
    expect(edited.flags).toContain('HUMAN_EDITED');
    const rejected = reviewCell(edited, 'reject', at);
    expect(rejected).toMatchObject({ status: 'NEEDS_REVIEW', value: null, verification: null });
    const reopened = reviewCell(rejected, 'reopen', at);
    expect(reopened).toMatchObject({ status: 'EXTRACTED', value: 'Accuracy 91%' });
    expect(reopened.flags).not.toContain('REJECTED_BY_REVIEWER');
    expect(reopened.history.map((entry) => entry.action)).toEqual(['extract', 'edit', 'reject', 'reopen']);
  });
  it('keeps a human-verified cell through a rerun unless told otherwise', () => {
    const verified = reviewCell(base, 'approve', at);
    const rerun = { ...base, value: 'new' };
    expect(mergeCells([verified], [rerun], { keepVerified: true })[0]?.status).toBe('VERIFIED');
    expect(mergeCells([verified], [rerun], { keepVerified: false })[0]?.value).toBe('new');
  });
  const project: ExtractionProject = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000003',
    title: 'P',
    researchQuestion: '',
    createdAt: at,
    updatedAt: at,
    papers: [projectPaper('k', 'FULL_TEXT')],
    fields: [field('results'), { ...field('dataset'), hidden: true }],
    runs: [],
    cells: [base],
    deep: null,
  };
  it('marks a cell stale when its field or source changes', () => {
    expect(isStale(base, project)).toBe(false);
    expect(isStale(base, { ...project, fields: [field('results', 2)] })).toBe(true);
    expect(
      isStale(base, { ...project, papers: [{ ...projectPaper('k', 'FULL_TEXT'), revision: 'r2' }] }),
    ).toBe(true);
    expect(cellCounts(project)).toMatchObject({ stale: 0, counts: { EXTRACTED: 1, VERIFIED: 0 } });
  });
  it('exports value and status apart, and only verified values when asked', () => {
    const csv = matrixCsv(project, { verifiedOnly: false });
    expect(csv.split('\n')[0]).toBe('Title,Year,DOI,Source access,Results,Results [status]');
    expect(csv).toContain('Accuracy 91%,EXTRACTED');
    expect(matrixCsv(project, { verifiedOnly: true })).toContain(',,EXTRACTED');
    expect(
      matrixCsv(
        { ...project, papers: [{ ...projectPaper('z', 'FULL_TEXT'), title: '=cmd' }] },
        { verifiedOnly: false },
      ),
    ).toContain("'=cmd");
    const json = matrixJson(project, { verifiedOnly: true });
    expect(json.cells).toEqual([]);
    expect(json.fields.map((item) => item.key)).toEqual(['results']);
    expect('abstract' in (json.papers[0] ?? {})).toBe(false);
  });
});
