import type { LibraryItem, Paper } from '@/core/schemas';
import { expect, it } from 'vitest';
import { addLocalPaperAbstracts, findLocalPaperMatches } from './localPaperMatches';

const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Imported local title',
  createdAt: '2026-11-23T00:00:00.000Z',
  updatedAt: '2026-11-23T00:00:00.000Z',
  source: { kind: 'pdf', fileName: 'paper.pdf', pageCount: 1, sha256: 'hash' },
  sections: [{ id: 'abstract', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 }],
  paragraphs: [
    {
      id: 'abstract-paragraph',
      sectionId: 'abstract',
      order: 0,
      text: 'Saved abstract from the imported paper.',
      pageStart: 1,
      kind: 'body',
      textHash: 'abstract-hash',
    },
  ],
};

const libraryItem: LibraryItem = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000002',
  doi: '10.1016/j.comnet.2025.111430',
  addedAt: '2026-11-23T00:00:00.000Z',
  updatedAt: '2026-11-23T00:00:00.000Z',
  lookup: 'done',
  title: 'AsyncDefender: Dynamic trust adaptation',
  authors: ['Researcher One'],
  year: 2025,
  venue: 'Computer Networks',
  access: 'unknown',
  oa_sources: [],
  arxiv_id: null,
  taxonomy: null,
  openalex_id: null,
  paper_id: paper.id,
  file_matches_title: true,
  error: null,
};
const summary = { id: paper.id, title: paper.title, detectedTitle: paper.title };

it('matches an imported article by DOI and returns linked metadata and abstract', () => {
  const matches = findLocalPaperMatches(
    'Tìm thông tin bài báo DOI 10.1016/j.comnet.2025.111430 giúp tôi',
    [summary],
    [],
    [libraryItem],
  );
  expect(addLocalPaperAbstracts(matches, [paper])).toEqual([
    {
      paperId: paper.id,
      title: libraryItem.title,
      doi: libraryItem.doi,
      authors: libraryItem.authors,
      year: libraryItem.year,
      venue: libraryItem.venue,
      abstract: 'Saved abstract from the imported paper.',
    },
  ]);
});

it('matches a sufficiently specific full title when no DOI is present', () => {
  expect(findLocalPaperMatches('Tell me about Imported local title please', [summary], [], [])).toMatchObject(
    [{ paperId: paper.id, title: paper.title }],
  );
});

it('does not return unrelated records or guess from a short title fragment', () => {
  expect(findLocalPaperMatches('Find AI', [summary], [], [])).toEqual([]);
});
