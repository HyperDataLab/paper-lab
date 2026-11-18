import { buildPaperModel } from '../paperModel';
import type { LibraryItem, Paper, ScgContribution, ScgPaperRun, ScgPrerequisite } from '../schemas';
import type { CorpusKgInput } from './corpus';

const at = '2026-01-01T00:00:00.000Z';
const doi = (n: number) => `10.1000/study-${n}`;
export const term = (slug: string, score: number) => ({ id: `keywords/${slug}`, name: slug, score });
const paper = (id: string, title: string, text: string, ref = ''): Paper => ({
  schemaVersion: 1,
  id,
  title,
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'synthetic.txt', pageCount: null, sha256: '' },
  sections: [
    { id: 'body', heading: 'Results', role: 'results', level: 1, pageStart: null },
    { id: 'refs', heading: 'References', role: 'references', level: 1, pageStart: null },
  ],
  paragraphs: [
    { id: 'p1', sectionId: 'body', order: 0, kind: 'body', text, textHash: '', pageStart: null },
    ...(ref
      ? [
          {
            id: 'p2',
            sectionId: 'refs',
            order: 1,
            kind: 'reference' as const,
            text: ref,
            textHash: '',
            pageStart: null,
          },
        ]
      : []),
  ],
});

function lookup(n: number, keywords: LibraryItem['keywords'], references: string[]): LibraryItem {
  return {
    schemaVersion: 1,
    id: `library-${n}`,
    doi: doi(n),
    title: null,
    authors: [],
    addedAt: at,
    updatedAt: at,
    lookup: 'done',
    access: 'unknown',
    oa_sources: [],
    arxiv_id: null,
    year: 2020 + n,
    venue: 'Synthetic venue',
    openalex_id: `https://openalex.org/W${n}`,
    openalex_source_id: 'S1',
    paper_id: null,
    file_matches_title: null,
    taxonomy: {
      topicId: 'topics/T1',
      topic: 'Synthetic topic',
      subfield: null,
      field: null,
      domainId: 'domains/1',
      domain: 'Synthetic domain',
      score: null,
    },
    keywords,
    referenced_works: references,
    authorships: [
      {
        id: 'A1',
        orcid: null,
        name: 'A. Example',
        institutions: [{ ror: '03yrm5c26', name: 'Example Institute', country: 'VN' }],
      },
      { id: 'A2', orcid: null, name: 'B. Example', institutions: [] },
    ],
    error: null,
  };
}

function run(id: string, contributions: ScgContribution[]): ScgPaperRun {
  return {
    schemaVersion: 1,
    paperId: id,
    doi: null,
    s2CorpusId: null,
    s2CheckedAt: null,
    idBase: id,
    promptVersion: 'test',
    promptVersions: { contributions: 'test', prerequisites: 'test', alignment: 'test' },
    requestedModel: 'test',
    model: 'test',
    status: 'complete',
    callsUsed: 0,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    contributions,
    progress: { fingerprint: '', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    reviewCarry: {},
    createdAt: at,
    updatedAt: at,
  };
}

export function corpusFixture(): CorpusKgInput {
  const alpha = paper('alpha', 'Alpha study', 'We introduce a synthetic dataset.');
  const beta = paper(
    'beta',
    'Beta study',
    'We reuse the dataset [1].',
    '[1] A. Example. doi:10.1000/ALPHA-ALIAS',
  );
  const alias = paper(
    'beta-v2',
    'Beta study revised',
    'We apply the synthetic dataset [1].',
    '[1] A. Example. doi:10.1000/study-1',
  );
  const betaModel = buildPaperModel({ paper: beta, metadata: null, now: new Date(at) });
  const keys = betaModel.sentences.map(({ key }) => key);
  const alphaContribution: ScgContribution = {
    id: 'alpha.c0',
    name: 'Alpha dataset',
    description: 'A synthetic dataset',
    review: 'accepted',
    prerequisites: [],
    types: [],
    sections: [],
    sourceSentenceKeys: [],
  };
  const prerequisite: ScgPrerequisite = {
    id: 'beta.c0.p0',
    name: 'Uses the Alpha dataset',
    description: '',
    explanation: '',
    coreOrPeripheral: 'core',
    review: 'accepted',
    references: [],
    sourceSentenceKeys: [...keys, 'missing#1'],
    matches: [
      { contributionId: alphaContribution.id, explanation: '', matchType: 'strong', review: 'accepted' },
    ],
  };
  const betaContribution: ScgContribution = {
    ...alphaContribution,
    id: 'beta.c0',
    name: 'Beta parser',
    prerequisites: [
      prerequisite,
      {
        ...prerequisite,
        id: 'beta.c0.p1',
        review: 'candidate',
        matches: [],
        references: [{ kind: 'contribution', contributionId: alphaContribution.id }],
      },
    ],
  };
  const identifiers = { libraryIds: [], sha256: [] };
  return {
    papers: [
      {
        paper: alpha,
        library: lookup(1, [term('common', 0.8), term('paired', 0.5)], ['W900']),
        scgRun: run(alpha.id, [alphaContribution]),
      },
      {
        paper: beta,
        model: betaModel,
        library: lookup(2, [term('common', 0.5), term('paired', 0.7)], ['W11', 'W3', 'W900']),
        scgRun: run(beta.id, [betaContribution]),
      },
      { paper: alias },
    ],
    members: [
      {
        memberId: 'a',
        title: 'Alpha study',
        stratum: { year: 2021 },
        identifiers: {
          ...identifiers,
          paperIds: [alpha.id],
          doi: doi(1),
          doiAliases: ['10.1000/alpha-alias'],
          openalexIdAliases: ['https://openalex.org/W11'],
        },
      },
      {
        memberId: 'b',
        title: 'Beta study',
        stratum: { year: 2022 },
        identifiers: { ...identifiers, paperIds: [beta.id, alias.id], doi: doi(2) },
      },
      {
        memberId: 'c',
        title: 'Gamma study',
        stratum: {},
        identifiers: { ...identifiers, paperIds: [], openalexId: 'W3' },
      },
    ],
    memberMetadata: new Map([['c', { keywords: [term('common', 0.3)] }]]),
  };
}
