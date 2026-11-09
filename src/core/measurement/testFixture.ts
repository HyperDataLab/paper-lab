import {
  PROTOCOL_FIELDS,
  type ExtractionOutput,
  type ModelField,
  type QuoteRef,
} from '../schemas/measurement';
import type { Paper, PaperParagraph } from '../schemas/paper';
import { buildProfile } from './build';
import { applyFindings, applyLinks } from './link';

/** A synthetic paper and its verified profile, shared by tests. Never contains text from a real paper. */
export const PAPER_ID = '00000000-0000-4000-8000-000000000001';
export const DEFINITION = 'Accuracy is the share of correct predictions over the whole test set.';
const para = (
  id: string,
  sectionId: string,
  text: string,
  extra: Partial<PaperParagraph> = {},
): PaperParagraph => ({
  id,
  sectionId,
  order: 0,
  text,
  pageStart: 3,
  kind: 'body',
  textHash: 'sha256:0',
  ...extra,
});
export const fixturePaper: Paper = {
  schemaVersion: 1,
  id: PAPER_ID,
  title: 'Synthetic paper',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: {
    kind: 'pdf',
    fileName: 'x.pdf',
    pageCount: 5,
    sha256: 'sha256:abc',
    parserVersion: 'paper-parser-2',
  },
  sections: [
    { id: 'met', heading: 'Methods', role: 'methods', level: 1, pageStart: 2 },
    { id: 'res', heading: 'Results', role: 'results', level: 1, pageStart: 3 },
  ],
  paragraphs: [
    para('m1', 'met', DEFINITION),
    para('t1', 'res', 'Model Accuracy (%)\nBaseline 0.123 ± 0.004', {
      kind: 'table',
      table: {
        captionId: null,
        columns: 2,
        confidence: 'high',
        rows: [
          {
            cells: [
              { text: 'Model', column: 0 },
              { text: 'Accuracy (%)', column: 1 },
            ],
          },
          {
            cells: [
              { text: 'Baseline', column: 0 },
              { text: '0.123 ± 0.004', column: 1 },
            ],
          },
        ],
      },
    }),
    para('r1', 'res', 'The baseline is robust under client dropout in our tests.'),
  ],
};
const q = (
  blockId: string,
  quote: string,
  row: number | null = null,
  column: number | null = null,
): QuoteRef => ({
  blockId,
  quote,
  row,
  column,
});
const none: ModelField = { value: null, status: 'NOT_REPORTED', quotes: [] };
const extraction: ExtractionOutput = {
  constructs: [{ key: 'q', name: 'Quality', description: 'How correct', quotes: [q('m1', DEFINITION)] }],
  metrics: [
    {
      key: 'acc',
      reported_name: 'Accuracy',
      aliases: [],
      construct_keys: ['q'],
      experiment_keys: ['e'],
      definition: { value: DEFINITION, status: 'REPORTED', quotes: [q('m1', DEFINITION)] },
      formula: none,
      unit: { value: '%', status: 'REPORTED', quotes: [q('t1', 'Accuracy (%)', 0, 1)] },
      direction: none,
      range: none,
      method: { input_data: none, procedure: none, data_source: none, aggregation: none },
    },
  ],
  experiments: [
    {
      key: 'e',
      name: 'Main',
      protocol: Object.fromEntries(
        PROTOCOL_FIELDS.map((key) => [key, none]),
      ) as ExtractionOutput['experiments'][number]['protocol'],
    },
  ],
  results: [
    {
      key: 'r',
      experiment_key: 'e',
      metric_key: 'acc',
      system_or_baseline: 'Baseline',
      value: '0.123',
      unit: '%',
      uncertainty: '0.004',
      condition: null,
      quote: q('t1', '0.123 ± 0.004', 1, 1),
    },
  ],
  claims: [{ key: 'c', text: 'Robust under dropout', quote: q('r1', 'robust under client dropout') }],
  taxonomy: [],
  review_method: null,
};
export function fixtureProfile() {
  const blocks = fixturePaper.paragraphs;
  const base = buildProfile({
    paper: fixturePaper,
    selectedSectionIds: ['met', 'res'],
    classification: { paper_type: 'EMPIRICAL', rationale: 'Có thí nghiệm', quotes: [] },
    units: [{ unit: { id: 'u', sectionIds: ['met', 'res'], blocks }, output: extraction }],
    model: 'test-model',
    promptVersion: 'v1',
    generatedAt: '2026-01-02T00:00:00.000Z',
  });
  const linked = applyLinks(base, {
    metric_merges: [],
    result_links: [],
    metric_experiments: [],
    claim_links: [
      {
        claim_id: 'cl-1',
        result_ids: ['r-1'],
        metric_ids: ['mu-1'],
        evidence_scope: 'Chỉ trong kịch bản đã đo.',
      },
    ],
  });
  return applyFindings(linked, {
    findings: [
      {
        type: 'protocol_incompleteness',
        severity: 'medium',
        explanation: 'Chưa thấy nêu seed.',
        limitation_of_assessment: 'Chỉ đọc phần đã phân tích.',
        suggested_question_to_author: 'Seed là gì?',
        related_item_ids: ['exp-1'],
        evidence_ids: [],
      },
    ],
  });
}
export const fixtureRun = (id = '00000000-0000-4000-8000-0000000000aa') => ({
  id,
  createdAt: '2026-01-02T00:00:00.000Z',
  callsUsed: 5,
  sectionIds: ['met', 'res'],
  profile: fixtureProfile(),
});
