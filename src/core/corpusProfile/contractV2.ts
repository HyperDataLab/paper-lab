import { z } from 'zod';
import type { KeywordPaper } from '../schemas/corpusKeywords';
import { CorpusProfileV2Schema } from '../schemas/corpusProfileV2';
import { exampleProfileInputs } from './contract';
import { buildCorpusProfileV2 } from './profileV2';
import { FEATURE_REGISTRY_V2, registryV2Digest } from './registryV2';

export const CORPUS_PROFILE_V2_SCHEMA_FILE = 'schemas/corpus-profile-v2.draft.schema.json';
export const CORPUS_PROFILE_V2_PUBLIC_FILE = 'public/schemas/corpus-profile-v2.draft.schema.json';
export const CORPUS_PROFILE_V2_EXAMPLE_FILE = 'schemas/examples/corpus-profile-v2.draft.example.json';
export const FEATURE_REGISTRY_V2_FILE = 'schemas/feature-registry-v2.json';

export function corpusProfileV2JsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(CorpusProfileV2Schema, {
    io: 'output',
    target: 'draft-2020-12',
  });
  return {
    $schema,
    $id: 'https://hyperdatalab-paragraph-lab.web.app/schemas/corpus-profile-v2.draft.schema.json',
    title: 'PaperLab corpus profile v2 DRAFT',
    description:
      'DRAFT contract for Writing Bank mapping; the shape may change until it leaves draft. Built by PaperLab from feature registry v2 (deterministic P2 features; P6 passive/tense and P7 evidence level not measured yet).',
    $comment: 'DRAFT: the example is built by PaperLab code from synthetic papers.',
    ...rest,
  };
}

/** Registry v2 as published, with the digest a v2 profile binds to. */
export async function featureRegistryV2Json() {
  return { ...FEATURE_REGISTRY_V2, digest: await registryV2Digest() };
}

/** The synthetic example: the v1 example corpora drawn as an `admired` top 7, with keywords and subfields. */
export async function exampleCorpusProfileV2() {
  const { target, control, papers } = exampleProfileInputs();
  for (const corpus of [target, control]) {
    const version = corpus.protocol.at(-1);
    if (version && 'samplingRule' in version.body)
      version.body = {
        ...version.body,
        sampling: { scope: 'admired', n: 7, rankedBy: 'cited_by_count within publication year' },
      };
    corpus.members.forEach((member, i) => {
      member.subfieldId = i % 3 === 2 ? 'subfields/1710' : 'subfields/1702';
    });
  }
  const keywords = (journal: boolean): KeywordPaper[] =>
    (journal ? target : control).members.map((member, i) => ({
      memberId: member.memberId,
      year: member.stratum.year ?? null,
      keywords: [
        { id: 'keywords/toy-task', name: 'Toy task', score: 0.5 },
        ...(journal || i % 3 === 0
          ? [{ id: 'keywords/synthetic-scheme', name: 'Synthetic scheme', score: 0.4 }]
          : []),
      ],
    }));
  const profile = await buildCorpusProfileV2({
    target,
    control,
    papers,
    keywords: { target: keywords(true), control: keywords(false) },
    subfieldNames: new Map([['subfields/1702', 'Artificial Intelligence']]),
    seed: 42,
    now: new Date('2026-11-18T00:00:00.000Z'),
  });
  // Writing Bank B1 keys on this marker (writing-bank doc 39 §6).
  return { ...profile, warnings: ['synthetic_fixture', ...profile.warnings] };
}
