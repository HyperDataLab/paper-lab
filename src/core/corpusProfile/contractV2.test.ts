/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CorpusProfileSchema } from '../schemas/corpusProfile';
import { CorpusProfileV2Schema } from '../schemas/corpusProfileV2';
import { CORPUS_PROFILE_EXAMPLE_FILE, FEATURE_REGISTRY_FILE, featureRegistryJson } from './contract';
import {
  CORPUS_PROFILE_V2_EXAMPLE_FILE,
  CORPUS_PROFILE_V2_PUBLIC_FILE,
  CORPUS_PROFILE_V2_SCHEMA_FILE,
  corpusProfileV2JsonSchema,
  exampleCorpusProfileV2,
  FEATURE_REGISTRY_V2_FILE,
  featureRegistryV2Json,
} from './contractV2';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('draft corpus profile v2 contract', () => {
  it('parses the generated example and retains v1 compatibility', async () => {
    const example = read(CORPUS_PROFILE_V2_EXAMPLE_FILE);
    expect(example).toEqual(await exampleCorpusProfileV2());
    const profile = CorpusProfileV2Schema.parse(example);
    expect(profile.scope).toBe('admired');
    expect(profile.features.every((feature) => feature.status === 'exploratory')).toBe(true);
    expect(CorpusProfileSchema.safeParse(read(CORPUS_PROFILE_EXAMPLE_FILE)).success).toBe(true);
    expect(CorpusProfileV2Schema.safeParse({ ...profile, draft: false }).success).toBe(false);
  });

  it('publishes both generated draft schema copies', () => {
    expect(read(CORPUS_PROFILE_V2_SCHEMA_FILE)).toEqual(corpusProfileV2JsonSchema());
    expect(read(CORPUS_PROFILE_V2_PUBLIC_FILE)).toEqual(corpusProfileV2JsonSchema());
  });

  it('P2 the generated example validates against the committed JSON Schema', () => {
    const schema = z.fromJSONSchema(
      read(CORPUS_PROFILE_V2_SCHEMA_FILE) as Parameters<typeof z.fromJSONSchema>[0],
    );
    expect(schema.safeParse(read(CORPUS_PROFILE_V2_EXAMPLE_FILE)).success).toBe(true);
    expect(
      schema.safeParse({ ...(read(CORPUS_PROFILE_V2_EXAMPLE_FILE) as object), scope: 'top' }).success,
    ).toBe(false);
  });

  it('P2 the committed registries match the code and the example binds to v2', async () => {
    expect(read(FEATURE_REGISTRY_V2_FILE)).toEqual(await featureRegistryV2Json());
    expect(read(FEATURE_REGISTRY_FILE)).toEqual(await featureRegistryJson());
    const registry = read(FEATURE_REGISTRY_V2_FILE) as { digest: string; version: number };
    const profile = CorpusProfileV2Schema.parse(read(CORPUS_PROFILE_V2_EXAMPLE_FILE));
    expect(profile.registry).toMatchObject({ version: 2, digest: registry.digest });
  });
});
