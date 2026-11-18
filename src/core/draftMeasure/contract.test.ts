import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_MEASURE_EXAMPLE_FILE,
  DRAFT_MEASURE_PUBLIC_FILE,
  DRAFT_MEASURE_SCHEMA_FILE,
  draftMeasureJsonSchema,
  exampleDraftMeasure,
} from './contract';
import { DraftMeasureSchema } from './schema';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('draft measure v1 contract', () => {
  it('parses the generated synthetic example', async () => {
    const example = DraftMeasureSchema.parse(read(DRAFT_MEASURE_EXAMPLE_FILE));
    expect(example).toEqual(await exampleDraftMeasure());
  });

  it('publishes both generated schema copies, with the request under $defs', () => {
    const schema = draftMeasureJsonSchema();
    expect(read(DRAFT_MEASURE_SCHEMA_FILE)).toEqual(schema);
    expect(read(DRAFT_MEASURE_PUBLIC_FILE)).toEqual(schema);
    expect((schema.$defs as Record<string, unknown>).request).toMatchObject({ required: ['format', 'text'] });
  });
});
