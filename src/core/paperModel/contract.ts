import { z } from 'zod';
import { fixturePaper } from '../measurement/testFixture';
import { PaperModelSchema, type Paper, type PaperInsightsRecord, type StanceRecord } from '../schemas';
import { buildPaperModel } from './buildPaperModel';

/**
 * The exchange contract with the lab's Writing Bank. PaperLab is the source of truth: the JSON Schema is
 * generated from `PaperModelSchema` here and the bank only keeps a read-only copy.
 */
export const PAPER_MODEL_SCHEMA_ID =
  'https://hyperdatalab-paragraph-lab.web.app/schemas/paper-model-v1.schema.json';
export const PAPER_MODEL_SCHEMA_FILE = 'schemas/paper-model-v1.schema.json';
/** Served copy, so the schema's `$id` resolves on Hosting. */
export const PAPER_MODEL_SCHEMA_PUBLIC_FILE = 'public/schemas/paper-model-v1.schema.json';
export const PAPER_MODEL_EXAMPLE_FILE = 'examples/paper-model.example.json';

export function paperModelJsonSchema(): Record<string, unknown> {
  // `output`: what a produced file holds, so fields with defaults are required, not optional.
  const { $schema, ...rest } = z.toJSONSchema(PaperModelSchema, { io: 'output', target: 'draft-2020-12' });
  return {
    $schema,
    $id: PAPER_MODEL_SCHEMA_ID,
    title: 'PaperLab paper model, version 1',
    description:
      'One paper as PaperLab models it: metadata, section tree, blocks, references, the sentence index with content keys, and sentence annotations (PaperLab rhetoric and stance today; CoreSC, AZ-II and NLPContributionGraph in later slices). Generated from PaperLab code; consumers must reject any other schemaVersion.',
    ...rest,
  };
}

const at = '2026-01-01T00:00:00.000Z';
const RUN = '00000000-0000-4000-8000-0000000000b1';
const STANCE_RUN = '00000000-0000-4000-8000-0000000000b2';

/** The fixture paper plus an abstract and a reference list, all synthetic text. */
export function examplePaper(): Paper {
  const extra = (id: string, sectionId: string, kind: 'body' | 'reference', text: string, page: number) => ({
    id,
    sectionId,
    order: 0,
    text,
    pageStart: page,
    kind,
    textHash: 'sha256:0',
  });
  return {
    ...fixturePaper,
    sections: [
      { id: 'abs', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
      ...fixturePaper.sections,
      { id: 'ref', heading: 'References', role: 'references', level: 1, pageStart: 5 },
    ],
    paragraphs: [
      extra('a1', 'abs', 'body', 'We describe a synthetic method. It is evaluated on a toy task.', 1),
      ...fixturePaper.paragraphs,
      extra(
        'x1',
        'ref',
        'reference',
        '[1] A. Synthetic. A toy reference. J. Examples, 2020. doi:10.5555/example.1',
        5,
      ),
    ],
  };
}

function span(paper: Paper, paragraphId: string, words: string) {
  const paragraph = paper.paragraphs.find((p) => p.id === paragraphId);
  const start = paragraph?.text.indexOf(words) ?? -1;
  if (!paragraph || start < 0) throw new Error(`Example span not found: ${words}`);
  const page = paragraph.pageStart;
  // Synthetic text is ASCII, so UTF-16 and code-point offsets agree.
  return {
    paragraphId,
    sectionId: paragraph.sectionId,
    page,
    start,
    end: start + words.length,
    excerpt: words,
  };
}

export function exampleInsights(paper: Paper): PaperInsightsRecord {
  return {
    schemaVersion: 1,
    paperId: paper.id,
    updatedAt: at,
    rhetoricRuns: [
      {
        id: RUN,
        createdAt: at,
        model: 'example-model',
        promptVersion: 'example-rhetoric-1',
        callsUsed: 1,
        sectionIds: ['abs', 'met', 'res'],
        failedSectionIds: [],
        items: [
          {
            id: 'i1',
            category: 'occupy',
            rationale: 'States what the paper does.',
            ...span(paper, 'a1', 'We describe a synthetic method.'),
          },
          {
            id: 'i2',
            category: 'result_statement',
            rationale: 'Reports an outcome.',
            ...span(paper, 'r1', 'The baseline is robust under client dropout'),
          },
          {
            id: 'i3',
            category: 'limitation',
            rationale: 'Scope of the tests.',
            ...span(paper, 'r1', 'in our tests'),
          },
        ],
        abstractClaims: [],
        abstractChecked: false,
        discarded: { not_found: 0, duplicate: 0 },
      },
    ],
    rhetoricPending: null,
    argumentRuns: [],
    argumentPending: null,
    snapshotRuns: [],
    digestRuns: [],
    contributionRuns: [],
    contributionPending: null,
    decisions: [
      { run_id: RUN, item_id: 'i1', decision: 'confirm', at },
      { run_id: RUN, item_id: 'i3', decision: 'dismiss', at },
    ],
  };
}

export function exampleStance(paper: Paper): StanceRecord {
  const marker = span(paper, 'r1', 'robust');
  return {
    schemaVersion: 1,
    paperId: paper.id,
    updatedAt: at,
    runs: [
      {
        id: STANCE_RUN,
        createdAt: at,
        model: 'example-model',
        promptVersion: 'example-stance-1',
        callsUsed: 1,
        sectionIds: ['res'],
        words: { res: 10 },
        failedSectionIds: [],
        annotations: [
          {
            id: 's1',
            paragraphId: 'r1',
            sectionId: 'res',
            page: marker.page,
            category: 'boosters',
            marker: 'robust',
            start: marker.start,
            end: marker.end,
            excerpt: 'The baseline is robust under client dropout',
            rationale: 'Asserts strength without a hedge.',
          },
        ],
        discarded: { not_found: 0, wrong_form: 0, duplicate: 0 },
      },
    ],
    decisions: [],
    pending: null,
  };
}

export function examplePaperModel() {
  const paper = examplePaper();
  return buildPaperModel({
    paper,
    metadata: null,
    insights: exampleInsights(paper),
    stance: exampleStance(paper),
    now: new Date('2026-11-11T00:00:00.000Z'),
  });
}
