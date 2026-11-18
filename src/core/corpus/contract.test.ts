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
  it('parses older journal protocols and round-trips optional Writing Bank references', () => {
    const example = exampleCorpus();
    const body = {
      venues: [{ name: 'Synthetic Journal', issn: ['1234-5679'], openalexSourceId: 'S12345' }],
      years: [2026],
      articleTypes: ['Synthetic article'],
      versionOfRecordOnly: true,
      samplingRule: '',
      seed: '',
      strata: [],
      capPerIssue: null,
      exclusions: [],
    };
    const protocol = { version: 1, createdAt: example.createdAt, body };
    const older = { ...example, kind: 'journal', protocol: [protocol] };
    expect(CorpusSchema.parse(older)).toEqual(older);
    const legacyBank = { release: '2031.02.1', journalId: 'jr.synthetic', articleTypeIds: ['art.synthetic'] };
    const bank = { journalId: 'jrn.synthetic', journalProfile: 'jr.synthetic', journalEdited: true };
    const linked = {
      ...older,
      protocol: [
        protocol,
        { ...protocol, version: 2, body: { ...body, bank: legacyBank } },
        { ...protocol, version: 3, body: { ...body, bank } },
      ],
    };
    expect(CorpusSchema.parse(JSON.parse(JSON.stringify(CorpusSchema.parse(linked))))).toEqual(linked);
    expect(
      CorpusSchema.safeParse({
        ...older,
        protocol: [{ ...protocol, body: { ...body, bank: { ...bank, journalId: 'art.synthetic' } } }],
      }).success,
    ).toBe(false);
  });
});
