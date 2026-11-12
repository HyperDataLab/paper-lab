import { z } from 'zod';
import { CorpusSchema } from '../schemas/corpus';
import { exportIdOf, newCorpus } from './index';

export const CORPUS_SCHEMA_ID = 'https://hyperdatalab-paragraph-lab.web.app/schemas/corpus-v1.schema.json';
export const CORPUS_SCHEMA_FILE = 'schemas/corpus-v1.schema.json';
export const CORPUS_SCHEMA_PUBLIC_FILE = 'public/schemas/corpus-v1.schema.json';
export const CORPUS_EXAMPLE_FILE = 'examples/corpus.example.json';

export function corpusJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(CorpusSchema, { io: 'output', target: 'draft-2020-12' });
  return {
    $schema,
    $id: CORPUS_SCHEMA_ID,
    title: 'PaperLab corpus, version 1',
    description: 'A corpus manifest without paper text, generated from PaperLab code.',
    ...rest,
  };
}

export function exampleCorpus() {
  const at = '2026-01-01T00:00:00.000Z';
  const memberId = '00000000-0000-4000-8000-000000000001';
  const corpus = newCorpus({
    id: 'example-corpus',
    kind: 'topic',
    title: 'Synthetic corpus',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          researchQuestion: 'A synthetic question?',
          inclusion: ['Synthetic records'],
          exclusion: [],
          years: [2020, 2021],
        },
      },
    ],
  });
  corpus.members.push({
    memberId,
    identifiers: { sha256: [], paperIds: [], libraryIds: [] },
    exportId: exportIdOf(memberId),
    role: null,
    stratum: {},
    version: null,
    retrieval: 'sought',
    textRead: 'METADATA_ONLY',
    authorIds: [],
    countries: [],
    decisions: [],
    appraisal: [],
    inputs: null,
  });
  return CorpusSchema.parse(corpus);
}
