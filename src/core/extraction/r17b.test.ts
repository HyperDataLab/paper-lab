import { expect, it } from 'vitest';
import { addFields, customField, MAX_COLUMNS, newProject, paperBibtex, paperRis } from './index';
import { ExtractionProjectSchema } from '../schemas/extraction';

it('R17b caps visible and hidden columns together, without counting duplicates', () => {
  const project = newProject({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Paper',
    researchQuestion: '',
    now: '2026-01-01T00:00:00.000Z',
  });
  const fields = Array.from({ length: 55 }, (_, i) =>
    customField({ label: `Field ${i}`, description: '', instruction: '', existing: [] }),
  );
  const first = addFields(project, fields.slice(0, 49));
  first.fields = first.fields.map((field, index) => (index === 0 ? { ...field, hidden: true } : field));
  const capped = addFields(first, [...fields.slice(0, 1), ...fields]);
  expect(capped.fields).toHaveLength(MAX_COLUMNS);
  expect(capped.fields[0]?.hidden).toBe(true);
});

it('R17b reads projects saved before paper ownership was introduced', () => {
  const { paperId: _paperId, ...old } = newProject({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Paper',
    researchQuestion: '',
    now: '2026-01-01T00:00:00.000Z',
  });
  expect(_paperId).toBeNull();
  expect(ExtractionProjectSchema.parse(old).paperId).toBeNull();
});

it('R17b exports citation metadata as RIS and escaped BibTeX', () => {
  const meta = {
    title: 'A {study} & result',
    authors: ['A. Author', 'B. Writer'],
    year: 2024,
    venue: 'Journal',
    doi: '10.1/example',
    volume: '3',
    issue: '2',
    pages: '4-8',
  };
  expect(paperRis(meta)).toContain('AU  - A. Author\r\nAU  - B. Writer');
  expect(paperRis(meta)).toContain('DO  - 10.1/example');
  expect(paperBibtex(meta)).toContain('title = {A \\{study\\} \\& result}');
  expect(paperBibtex(meta)).toContain('author = {A. Author and B. Writer}');
  expect(paperRis({ ...meta, doi: null })).not.toContain('DO  -');
});
