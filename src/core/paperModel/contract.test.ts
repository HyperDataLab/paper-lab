/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PaperModelSchema } from '../schemas';
import {
  examplePaperModel,
  PAPER_MODEL_EXAMPLE_FILE,
  PAPER_MODEL_SCHEMA_FILE,
  PAPER_MODEL_SCHEMA_ID,
  PAPER_MODEL_SCHEMA_PUBLIC_FILE,
  paperModelJsonSchema,
} from './contract';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('R17a paper-model contract with Writing Bank', () => {
  it('the committed JSON Schema matches the code (run npm run schema:paper-model)', () => {
    const schema = paperModelJsonSchema();
    expect(schema.$id).toBe(PAPER_MODEL_SCHEMA_ID);
    expect(read(PAPER_MODEL_SCHEMA_FILE)).toEqual(schema);
    expect(read(PAPER_MODEL_SCHEMA_PUBLIC_FILE)).toEqual(schema);
  });
  it('the committed example matches the code and validates', () => {
    const example = read(PAPER_MODEL_EXAMPLE_FILE);
    expect(example).toEqual(examplePaperModel());
    const model = PaperModelSchema.parse(example);
    expect(model.sentences.length).toBeGreaterThan(0);
    expect(model.document.references.length).toBeGreaterThan(0);
    const schemes = new Set(model.annotations.map((a) => a.scheme));
    expect(schemes.has('paperlab-rhetoric')).toBe(true);
    expect(schemes.has('paperlab-stance')).toBe(true);
  });
  it('the schema requires what a produced file always holds', () => {
    const schema = paperModelJsonSchema() as { required: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'format',
        'schemaVersion',
        'document',
        'sentences',
        'annotations',
        'annotationRuns',
      ]),
    );
  });
});
