import { describe, expect, it } from 'vitest';
import { candidateFromWork, emptyDeep } from '../extraction/deep';
import type { Candidate, ExtractionProject } from '../schemas';
import { linkTopic, promoteProject, recordTopicSearch } from './topic';

const at = '2026-01-01T00:00:00.000Z';
const candidate = candidateFromWork(
  {
    id: 'https://openalex.org/W1',
    doi: 'https://doi.org/10.1234/a',
    display_name: 'Example',
    publication_year: 2024,
  },
  'query',
) as Candidate;
const project = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Review',
  researchQuestion: 'Why?',
  paperId: null,
  schemaVersion: 1,
  createdAt: at,
  updatedAt: at,
  papers: [],
  fields: [],
  runs: [],
  cells: [],
  deep: {
    ...emptyDeep(),
    candidates: [{ ...candidate, status: 'included', reason: 'human', decidedAt: at }],
  },
} satisfies ExtractionProject;

describe('C3a topic corpus', () => {
  it('promotes deep research decisions and links without replacing cells', () => {
    const corpus = promoteProject(project, 'corpus', at);
    expect(corpus.deep).toEqual(project.deep);
    expect(corpus.members[0]?.decisions[0]).toMatchObject({ decision: 'include', reasonText: 'human' });
    const linked = linkTopic(project, corpus);
    expect(linked.corpusId).toBe('corpus');
    expect(linked.papers).toHaveLength(1);
    expect(linked.cells).toBe(project.cells);
    expect(linkTopic(linked, corpus).papers).toHaveLength(1);
  });
  it('records reproducible searches and deduplicates across searches', () => {
    const corpus = promoteProject({ ...project, deep: emptyDeep() }, 'corpus', at);
    const url = 'https://api.openalex.org/works?search=test&per-page=50';
    const first = recordTopicSearch(corpus, [candidate], url, 100, 1, at);
    const second = recordTopicSearch(first, [candidate], url, 1, 1, at);
    expect(first.searches[0]).toMatchObject({
      source: 'openalex',
      requestUrl: url,
      params: { search: 'test', 'per-page': '50' },
      runAt: at,
      totalReported: 100,
      retrieved: 1,
      duplicates: 0,
      added: 1,
      truncated: true,
    });
    expect(second.searches[1]).toMatchObject({ duplicates: 1, added: 0, truncated: false });
    expect(second.members).toHaveLength(1);
  });
});
