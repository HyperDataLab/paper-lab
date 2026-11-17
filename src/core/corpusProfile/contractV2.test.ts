/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorpusProfileSchema } from '../schemas/corpusProfile';
import { CorpusProfileV2Schema } from '../schemas/corpusProfileV2';
import { CORPUS_PROFILE_EXAMPLE_FILE } from './contract';
import {
  CORPUS_PROFILE_V2_PUBLIC_FILE,
  CORPUS_PROFILE_V2_SCHEMA_FILE,
  corpusProfileV2JsonSchema,
} from './contractV2';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('draft corpus profile v2 contract', () => {
  it('parses the synthetic fixture and retains v1 compatibility', () => {
    const profile = CorpusProfileV2Schema.parse(
      read('schemas/examples/corpus-profile-v2.draft.example.json'),
    );
    expect(profile.scope).toBe('admired');
    expect(profile.features.every((feature) => feature.status === 'exploratory')).toBe(true);
    expect(CorpusProfileSchema.safeParse(read(CORPUS_PROFILE_EXAMPLE_FILE)).success).toBe(true);
    expect(CorpusProfileV2Schema.safeParse({ ...profile, draft: false }).success).toBe(false);
  });

  it('publishes both generated draft schema copies', () => {
    expect(read(CORPUS_PROFILE_V2_SCHEMA_FILE)).toEqual(corpusProfileV2JsonSchema());
    expect(read(CORPUS_PROFILE_V2_PUBLIC_FILE)).toEqual(corpusProfileV2JsonSchema());
  });
});
