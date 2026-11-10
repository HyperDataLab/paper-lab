import { describe, expect, it } from 'vitest';
import type { LibraryItem, Paper } from '../schemas';
import { catalogField } from './catalog';
import {
  addFields,
  addPapers,
  customField,
  editInstruction,
  moveField,
  newProject,
  projectPaperFromLibrary,
  projectPaperFromPaper,
  removeField,
  removePaper,
  updateField,
} from './project';

const at = '2026-01-01T00:00:00.000Z';
const paper = (text: string): Paper => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Imported',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'a.pdf', pageCount: 1, sha256: 'x' },
  sections: [],
  paragraphs: [{ id: 'p', sectionId: 's', order: 0, text, kind: 'body', textHash: text, pageStart: 1 }],
});
const library: LibraryItem = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000005',
  doi: '10.1/x',
  addedAt: at,
  updatedAt: at,
  lookup: 'done',
  title: 'From library',
  authors: ['A'],
  year: 2020,
  venue: 'V',
  access: 'unknown',
  oa_sources: [],
  arxiv_id: null,
  taxonomy: null,
  openalex_id: null,
  paper_id: null,
  file_matches_title: null,
  error: null,
};
const project = () =>
  newProject({ id: '00000000-0000-4000-8000-000000000003', title: ' P ', researchQuestion: ' RQ ', now: at });

describe('extraction project', () => {
  it('starts empty with trimmed text', () => {
    expect(project()).toMatchObject({ title: 'P', researchQuestion: 'RQ', papers: [], fields: [] });
  });
  it('reads an imported paper in full and a DOI from its abstract or metadata', () => {
    expect(projectPaperFromPaper(paper('a'), library)).toMatchObject({
      access: 'FULL_TEXT',
      title: 'From library',
      doi: '10.1/x',
    });
    expect(projectPaperFromPaper(paper('a')).revision).not.toBe(projectPaperFromPaper(paper('b')).revision);
    expect(projectPaperFromLibrary(library, 'An abstract.')).toMatchObject({
      access: 'ABSTRACT_ONLY',
      abstract: 'An abstract.',
    });
    expect(projectPaperFromLibrary({ ...library, title: null }, null)).toMatchObject({
      access: 'METADATA_ONLY',
      title: '10.1/x',
      revision: 'metadata',
    });
  });
  it('never adds the same paper or DOI twice and removes a paper with its cells', () => {
    const one = addPapers(project(), [projectPaperFromPaper(paper('a'), library)]);
    const two = addPapers(one, [
      projectPaperFromLibrary({ ...library, doi: '10.1/X' }, null),
      projectPaperFromPaper(paper('a')),
    ]);
    expect(two.papers).toHaveLength(1);
    const removed = removePaper(
      { ...two, cells: [{ paperKey: two.papers[0]?.key } as never] },
      two.papers[0]?.key ?? '',
    );
    expect(removed.papers).toEqual([]);
    expect(removed.cells).toEqual([]);
  });
  const field = (key: string) => catalogField(key) as NonNullable<ReturnType<typeof catalogField>>;
  it('adds, hides, moves and removes columns without touching cells', () => {
    let value = addFields(project(), [field('tldr'), field('results'), field('tldr')]);
    expect(value.fields.map((item) => item.key)).toEqual(['tldr', 'results']);
    value = updateField(value, 'tldr', { hidden: true });
    expect(value.fields[0]?.hidden).toBe(true);
    value = moveField(value, 'results', -1);
    expect(value.fields.map((item) => item.key)).toEqual(['results', 'tldr']);
    expect(moveField(value, 'results', -1)).toBe(value);
    expect(moveField(value, 'missing', 1)).toBe(value);
    expect(removeField({ ...value, cells: [{ fieldKey: 'tldr' } as never] }, 'tldr').cells).toHaveLength(1);
  });
  it('versions a column when its instruction changes', () => {
    const value = addFields(project(), [field('results')]);
    expect(editInstruction(value, 'results', field('results').instruction).fields[0]?.version).toBe(1);
    expect(editInstruction(value, 'results', 'Only test-set numbers.').fields[0]).toMatchObject({
      version: 2,
      instruction: 'Only test-set numbers.',
    });
  });
  it('gives a custom column a unique key and a fallback instruction', () => {
    const first = customField({
      label: 'Độ trễ (ms)',
      description: 'Latency',
      instruction: '',
      existing: [],
    });
    expect(first).toMatchObject({ key: 'custom_do_tre_ms', custom: true, version: 1 });
    expect(first.instruction).toContain('Độ trễ (ms)');
    expect(
      customField({ label: 'Độ trễ (ms)', description: '', instruction: 'x', existing: [first.key] }).key,
    ).toBe('custom_do_tre_ms_2');
    expect(customField({ label: '!!!', description: '', instruction: 'x', existing: [] }).key).toBe(
      'custom_field',
    );
  });
});
