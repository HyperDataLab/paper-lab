import { z } from 'zod';
import { examplePaperModel } from '../paperModel/contract';
import type { ScgPaperRun } from '../schemas';
import { projectScgPaper, ScgPaperPublishSchema } from './publish';

export const SCG_PAPER_SCHEMA_ID =
  'https://hyperdatalab-paragraph-lab.web.app/schemas/scg-paper-v1.schema.json';
export const SCG_PAPER_SCHEMA_FILE = 'schemas/scg-paper-v1.schema.json';
export const SCG_PAPER_SCHEMA_PUBLIC_FILE = 'public/schemas/scg-paper-v1.schema.json';
export const SCG_PAPER_EXAMPLE_FILE = 'schemas/examples/scg-paper-v1.example.json';

export function scgPaperJsonSchema() {
  const { $schema, ...rest } = z.toJSONSchema(ScgPaperPublishSchema, {
    io: 'output',
    target: 'draft-2020-12',
  });
  return {
    $schema,
    $id: SCG_PAPER_SCHEMA_ID,
    title: 'PaperLab SCG paper, version 1',
    description:
      'One paper’s Scientific Contribution Graph as PaperLab publishes it: contributions, their prerequisites and matches to other lab papers, without rejected items. Evidence is sentence keys of the published paper model. Generated from PaperLab code; consumers must reject any other schemaVersion.',
    ...rest,
  };
}

/** A finished synthetic run on the example paper, with one rejected item at each level. */
export function exampleScgRun(): ScgPaperRun {
  const keys = examplePaperModel().sentences.map((sentence) => sentence.key);
  const key = (index: number) => keys[index % keys.length] as string;
  const at = '2026-11-11T00:00:00.000Z';
  const base = '00000000-0000-4000-8000-000000000001';
  return {
    schemaVersion: 1,
    paperId: base,
    doi: '10.5555/example.0',
    s2CorpusId: null,
    s2CheckedAt: at,
    idBase: base,
    promptVersion: 'scg-c1+scg-p1+scg-a1',
    promptVersions: { contributions: 'scg-c1', prerequisites: 'scg-p1', alignment: 'scg-a1' },
    requestedModel: 'example-model',
    model: 'example-model',
    status: 'complete',
    callsUsed: 3,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    contributions: [
      {
        id: `${base}.c0`,
        name: 'Synthetic method',
        description: 'A toy method evaluated on a toy task.',
        types: [{ type: 'techniques_algorithms', explanation: 'It is a new method.' }],
        sections: ['Abstract'],
        sourceSentenceKeys: [key(0)],
        review: 'accepted',
        prerequisites: [
          {
            id: `${base}.c0.p0`,
            name: 'Toy reference method',
            description: 'A method from an earlier synthetic paper.',
            explanation: 'The synthetic method extends it.',
            coreOrPeripheral: 'core',
            references: [
              {
                kind: 'paper',
                refId: 'ref1',
                title: 'A toy reference',
                year: 2020,
                doi: '10.5555/example.1',
                s2CorpusId: null,
              },
              { kind: 'contribution', contributionId: `${base}.c2` },
            ],
            matches: [
              {
                contributionId: '00000000-0000-4000-8000-000000000002.c0',
                explanation: 'The same toy method.',
                matchType: 'strong',
                review: 'candidate',
              },
              {
                contributionId: '00000000-0000-4000-8000-000000000003.c1',
                explanation: 'A loosely related method.',
                matchType: 'weak',
                review: 'rejected',
              },
            ],
            sourceSentenceKeys: [key(1)],
            review: 'candidate',
          },
          {
            id: `${base}.c0.p1`,
            name: 'Rejected prerequisite',
            description: 'Not a real dependency.',
            explanation: '',
            coreOrPeripheral: 'peripheral',
            references: [],
            matches: [],
            sourceSentenceKeys: [key(1)],
            review: 'rejected',
          },
        ],
      },
      {
        id: `${base}.c1`,
        name: 'Toy task evaluation',
        description: 'Results of the method on the toy task.',
        types: [{ type: 'empirical_evaluation', explanation: 'New experimental results.' }],
        sections: ['Abstract'],
        sourceSentenceKeys: [key(1)],
        review: 'candidate',
        prerequisites: [],
      },
      {
        id: `${base}.c2`,
        name: 'Rejected contribution',
        description: 'Not a contribution of the paper.',
        types: [{ type: 'other', explanation: '' }],
        sections: [],
        sourceSentenceKeys: [key(2)],
        review: 'rejected',
        prerequisites: [],
      },
    ],
    progress: { fingerprint: '0', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    reviewCarry: {},
    createdAt: at,
    updatedAt: at,
  };
}

export function exampleScgPaper() {
  return projectScgPaper(exampleScgRun(), `sha256-${'a'.repeat(64)}`);
}
