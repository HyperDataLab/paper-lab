/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorpusProfileSchema } from '../schemas/corpusProfile';
import {
  CORPUS_PROFILE_EXAMPLE_FILE,
  CORPUS_PROFILE_SCHEMA_FILE,
  CORPUS_PROFILE_SCHEMA_ID,
  CORPUS_PROFILE_SCHEMA_PUBLIC_FILE,
  corpusProfileJsonSchema,
  exampleCorpusProfile,
  FEATURE_REGISTRY_FILE,
  featureRegistryJson,
} from './contract';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('C5a corpus-profile contract with Writing Bank', () => {
  it('C5a the committed JSON Schema copies match the code (run npm run schema:corpus-profile)', () => {
    const schema = corpusProfileJsonSchema();
    expect(schema.$id).toBe(CORPUS_PROFILE_SCHEMA_ID);
    expect(read(CORPUS_PROFILE_SCHEMA_FILE)).toEqual(schema);
    expect(read(CORPUS_PROFILE_SCHEMA_PUBLIC_FILE)).toEqual(schema);
    expect((schema as { required: string[] }).required).toEqual(
      expect.arrayContaining([
        'format',
        'schemaVersion',
        'registry',
        'features',
        'distinctiveFeatureIds',
        'phrases',
        'interpretationStatus',
      ]),
    );
  });
  it('C5a the committed feature registry matches the code', async () => {
    expect(read(FEATURE_REGISTRY_FILE)).toEqual(await featureRegistryJson());
  });
  it('C5a the committed example matches the code, validates and binds to the published registry', async () => {
    const example = read(CORPUS_PROFILE_EXAMPLE_FILE);
    expect(example).toEqual(await exampleCorpusProfile());
    const profile = CorpusProfileSchema.parse(example);
    const registry = read(FEATURE_REGISTRY_FILE) as { digest: string; version: number };
    expect(profile.registry.digest).toBe(registry.digest);
    expect(profile.registry.version).toBe(registry.version);
    expect(profile.distinctiveFeatureIds.length).toBeGreaterThan(0);
    expect(profile.phrases.items.length).toBeGreaterThan(0);
    expect(profile.phrases.items.flatMap((p) => p.evidence).every((e) => e.excerpt.length <= 300)).toBe(true);
  });
  it('C5a rejects an unknown status and an over-long excerpt', async () => {
    const profile = await exampleCorpusProfile();
    expect(CorpusProfileSchema.safeParse({ ...profile, interpretationStatus: 'proven' }).success).toBe(false);
    const phrase = profile.phrases.items[0];
    if (!phrase) throw new Error('missing phrase');
    const long = {
      ...phrase,
      evidence: [{ memberExportId: 'p1x', sentenceKey: 'k', excerpt: 'x'.repeat(301) }],
    };
    expect(
      CorpusProfileSchema.safeParse({ ...profile, phrases: { ...profile.phrases, items: [long] } }).success,
    ).toBe(false);
  });
});
