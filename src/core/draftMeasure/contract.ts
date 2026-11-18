import { z } from 'zod';
import { measureDraft } from './measureDraft';
import { DraftInputSchema, DraftMeasureSchema } from './schema';

export const DRAFT_MEASURE_SCHEMA_FILE = 'schemas/draft-measure-v1.schema.json';
export const DRAFT_MEASURE_PUBLIC_FILE = 'public/schemas/draft-measure-v1.schema.json';
export const DRAFT_MEASURE_EXAMPLE_FILE = 'schemas/examples/draft-measure-v1.example.json';

/** JSON Schema of the POST /v1/measure response; the request shape sits under `$defs.request`. */
export function draftMeasureJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(DraftMeasureSchema, { io: 'output', target: 'draft-2020-12' });
  const request: Record<string, unknown> = z.toJSONSchema(DraftInputSchema, {
    io: 'input',
    target: 'draft-2020-12',
  });
  delete request.$schema;
  return {
    $schema,
    $id: 'https://hyperdatalab-paragraph-lab.web.app/schemas/draft-measure-v1.schema.json',
    title: 'PaperLab draft measure v1',
    description:
      "Response of PaperLab's POST /v1/measure: a writer's draft measured against feature registry v2 with no LLM pass (Writing Bank B4). `$defs.request` is the request body.",
    ...rest,
    $defs: { ...(rest.$defs as Record<string, unknown> | undefined), request },
  };
}

/** A synthetic markdown draft, measured with no grammar service (the worker's default). */
export const EXAMPLE_DRAFT = {
  format: 'markdown',
  title: 'A toy study of synthetic widgets',
  text: [
    '## 1. Introduction',
    '',
    'Widgets may matter for toy tasks. We study them here.',
    '',
    'Prior toy work clearly ignored widgets [1].',
    '',
    '## 2. Methods',
    '',
    'The widgets were measured twice. We counted every widget.',
    '',
    '## 3. Results and discussion',
    '',
    'The widgets were larger than expected. This suggests a toy effect.',
    '',
    '## Acknowledgements',
    '',
    'We thank the synthetic lab.',
  ].join('\n'),
} as const;

export function exampleDraftMeasure() {
  return measureDraft(EXAMPLE_DRAFT);
}
