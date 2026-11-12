/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorpusSchema } from '../schemas/corpus';
import {
  CORPUS_EXAMPLE_FILE,
  CORPUS_SCHEMA_FILE,
  CORPUS_SCHEMA_ID,
  CORPUS_SCHEMA_PUBLIC_FILE,
  corpusJsonSchema,
  exampleCorpus,
} from './contract';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
describe('C1a corpus contract', () => {
  it('C1a generated schema copies match the code', () => {
    const schema = corpusJsonSchema();
    expect(schema.$id).toBe(CORPUS_SCHEMA_ID);
    expect(read(CORPUS_SCHEMA_FILE)).toEqual(schema);
    expect(read(CORPUS_SCHEMA_PUBLIC_FILE)).toEqual(schema);
  });
  it('C1a synthetic example matches and validates', () => {
    const example = read(CORPUS_EXAMPLE_FILE);
    expect(example).toEqual(exampleCorpus());
    expect(CorpusSchema.parse(example).members).toHaveLength(1);
  });
  it('C1a rejects a protocol body for another kind', () => {
    expect(CorpusSchema.safeParse({ ...exampleCorpus(), kind: 'journal' }).success).toBe(false);
  });
});
