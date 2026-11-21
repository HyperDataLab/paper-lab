import { expect, it } from 'vitest';
import {
  coauthorUpdates,
  cooccurUpdates,
  expansionTargets,
  mapOpenAlexWorkToKg,
  normalizeText,
} from './index';

it('maps the paper, source, abstract and inbound identifiers without writing stub papers', () => {
  const result = mapOpenAlexWorkToKg({
    id: 'https://openalex.org/W10',
    doi: 'https://doi.org/10.1000/Invented',
    title: '  <i>Étage</i> Study ',
    abstract_inverted_index: { 'again.': [3], Start: [0], go: [1, 2, -1] },
    publication_year: 2022,
    cited_by_count: 9,
    type: 'article',
    primary_location: { source: { id: 'https://openalex.org/S3', display_name: 'Synthetic Review' } },
    referenced_works: ['https://openalex.org/W20', 'W20', 'W10', 'invalid', null],
    related_works: ['W30'],
  });
  expect(result.nodes.paper).toEqual({
    id: 'W10',
    doi: '10.1000/invented',
    title: 'Étage Study',
    title_normalized: 'etage study',
    abstract: 'Start go go again.',
    publication_year: 2022,
    cited_by_count: 9,
    type: 'article',
    source_id: 'S3',
    subfield_id: null,
  });
  expect(result.nodes.source).toEqual([{ id: 'S3', display_name: 'Synthetic Review' }]);
  expect(result.edges.cites).toEqual([{ paper_id: 'W10', target_id: 'W20' }]);
  expect(result.edges.related_to).toEqual([{ paper_id: 'W10', target_id: 'W30' }]);
  expect(
    mapOpenAlexWorkToKg({ id: 'W20', abstract_inverted_index: { word: [null, -4, 1.5, '0'] } }).nodes.paper
      .abstract,
  ).toBeNull();
  expect(() => mapOpenAlexWorkToKg({ id: 'A20' })).toThrow();
});

it('maps keywords with the best score, authors in byline order, and paper-scoped affiliations', () => {
  const { nodes, edges } = mapOpenAlexWorkToKg({
    id: 'W10',
    keywords: [
      null,
      { id: 'not-a-keyword', display_name: 'Ignored' },
      { id: 'https://openalex.org/keywords/learning', display_name: 'Learning', score: 0.3 },
      { id: 'keywords/learning', display_name: 'Learning', score: 0.9 },
    ],
    authorships: [
      {
        author: {
          id: 'https://openalex.org/A4',
          display_name: 'A. Example',
          orcid: 'https://orcid.org/example',
        },
        institutions: [
          {
            id: 'https://openalex.org/I2',
            display_name: 'Example College',
            country_code: 'VN',
            ror: 'https://ror.org/example',
          },
        ],
      },
      { author: { display_name: 'Unknown identifier' } },
      { author: { id: 'A3', display_name: 'B. Example' } },
    ],
  });
  expect(nodes.keyword).toEqual([{ id: 'keywords/learning', text: 'Learning', text_normalized: 'learning' }]);
  expect(edges.has_keyword).toEqual([
    { paper_id: 'W10', keyword_id: 'keywords/learning', relevance_score: 0.9 },
  ]);
  expect(nodes.author).toEqual([
    { id: 'A4', display_name: 'A. Example', orcid: 'https://orcid.org/example' },
    { id: 'A3', display_name: 'B. Example', orcid: null },
  ]);
  expect(nodes.institution).toEqual([
    { id: 'I2', display_name: 'Example College', country_code: 'VN', ror: 'https://ror.org/example' },
  ]);
  expect(edges.affiliated).toEqual([{ paper_id: 'W10', author_id: 'A4', institution_id: 'I2' }]);
  expect(edges.authored).toEqual([
    { paper_id: 'W10', author_id: 'A4', position: 1 },
    { paper_id: 'W10', author_id: 'A3', position: 3 },
  ]);
});

it('maps topics and hierarchy, including repeated primary topics and sparse secondary topics', () => {
  const primary = {
    id: 'https://openalex.org/T1',
    display_name: 'Theme',
    score: 0.8,
    subfield: { id: 'https://openalex.org/subfields/2', display_name: 'Subdiscipline' },
    field: { id: 'fields/3', display_name: 'Discipline' },
    domain: { id: 'domains/4', display_name: 'Area' },
  };
  const { nodes, edges } = mapOpenAlexWorkToKg({
    id: 'W10',
    primary_topic: primary,
    topics: [
      { ...primary, score: 0.7 },
      { id: 'topics/T2', display_name: 'Other', score: 0.4 },
    ],
  });
  expect(nodes.topic).toEqual([
    { id: 'topics/T1', display_name: 'Theme' },
    { id: 'topics/T2', display_name: 'Other' },
  ]);
  expect(nodes.subfield).toEqual([{ id: 'subfields/2', display_name: 'Subdiscipline' }]);
  expect(nodes.field).toEqual([{ id: 'fields/3', display_name: 'Discipline' }]);
  expect(nodes.domain).toEqual([{ id: 'domains/4', display_name: 'Area' }]);
  expect(nodes.paper.subfield_id).toBe('subfields/2');
  expect(edges.has_topic).toEqual([
    { paper_id: 'W10', topic_id: 'topics/T1', score: 0.8 },
    { paper_id: 'W10', topic_id: 'topics/T2', score: 0.4 },
  ]);
  expect(edges.subfield_of).toEqual([{ topic_id: 'topics/T1', subfield_id: 'subfields/2' }]);
  expect(edges.field_of).toEqual([{ subfield_id: 'subfields/2', field_id: 'fields/3' }]);
  expect(edges.domain_of).toEqual([{ field_id: 'fields/3', domain_id: 'domains/4' }]);
});

it('normalizes case, compatibility characters, diacritics and punctuation for search', () => {
  expect(normalizeText('  ÉCOLE—ＡＩ… Việt 2026, 研究 😀  ')).toBe('ecole ai viet 2026 研究');
  expect(normalizeText('?!')).toBe('');
});

it('counts one pair per paper and computes Jaccard with singleton papers in the denominator', () => {
  expect(cooccurUpdates([['b', 'a', 'a'], ['a', 'b', 'c'], ['a'], []])).toEqual([
    { left_id: 'a', right_id: 'b', count: 2, jaccard: 2 / 3 },
    { left_id: 'a', right_id: 'c', count: 1, jaccard: 1 / 3 },
    { left_id: 'b', right_id: 'c', count: 1, jaccard: 1 / 2 },
  ]);
  expect(coauthorUpdates([['A2', 'A1', 'A1'], ['A1', 'A2'], ['A3']])).toEqual([
    { left_id: 'A1', right_id: 'A2', count: 2 },
  ]);
});

it('expands all references and only the ranked citing window, excluding duplicates and self', () => {
  const work = {
    id: 'W1',
    referenced_works: ['https://openalex.org/W2', 'W1', 'bad'],
    citing_works: ['W2', 'W3', 'W4'],
  };
  expect(expansionTargets(work, { depth: 0 })).toEqual([]);
  expect(expansionTargets(work, { depth: 2, citedByTopN: 2 })).toEqual([
    { id: 'W2', depth: 1 },
    { id: 'W3', depth: 1 },
  ]);
});
