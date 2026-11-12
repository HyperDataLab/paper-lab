import { z } from 'zod';
import { exportIdOf, newCorpus } from '../corpus';
import { buildPaperModel } from '../paperModel/buildPaperModel';
import { examplePaper } from '../paperModel/contract';
import type { Corpus, CorpusMember } from '../schemas/corpus';
import { CorpusProfileSchema } from '../schemas/corpusProfile';
import type { Paper } from '../schemas/paper';
import { buildCorpusProfile, type ProfilePaper } from './profile';
import { FEATURE_REGISTRY, registryDigest } from './registry';

/**
 * The corpus-profile contract with the lab's Writing Bank. PaperLab computes the profile; the bank vendors the
 * generated schema and registry read-only and maps them into its Journal Signature, never recomputing values.
 */
export const CORPUS_PROFILE_SCHEMA_ID =
  'https://hyperdatalab-paragraph-lab.web.app/schemas/corpus-profile-v1.schema.json';
export const CORPUS_PROFILE_SCHEMA_FILE = 'schemas/corpus-profile-v1.schema.json';
export const CORPUS_PROFILE_SCHEMA_PUBLIC_FILE = 'public/schemas/corpus-profile-v1.schema.json';
export const CORPUS_PROFILE_EXAMPLE_FILE = 'examples/corpus-profile.example.json';
export const FEATURE_REGISTRY_FILE = 'schemas/feature-registry-v1.json';

export function corpusProfileJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(CorpusProfileSchema, { io: 'output', target: 'draft-2020-12' });
  return {
    $schema,
    $id: CORPUS_PROFILE_SCHEMA_ID,
    title: 'PaperLab corpus profile, version 1',
    description:
      'Per-feature values, summary statistics, paper-level comparisons (bootstrap CI, Mann–Whitney, Benjamini–Hochberg) and phrase keyness of a journal corpus against its control. Generated from PaperLab code; consumers must reject any other schemaVersion.',
    ...rest,
  };
}

/** The feature registry as published: the registry itself plus the digest a profile binds to. */
export async function featureRegistryJson() {
  return { ...FEATURE_REGISTRY, digest: await registryDigest(FEATURE_REGISTRY) };
}

const at = '2026-01-01T00:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A synthetic paper: an introduction whose length and wording differ between target and control. */
export function syntheticPaper(n: number, journal: boolean): Paper {
  const base = examplePaper();
  const filler = (count: number) => Array.from({ length: count }, (_, i) => `word${(i + n) % 7}`).join(' ');
  const intro = journal
    ? `To the best of our knowledge this synthetic scheme is new. It extends a toy idea ${filler(20 + n)}.`
    : `We revisit a synthetic toy problem ${filler(4 + (n % 3))}.`;
  const paragraph = (id: string, sectionId: string, text: string) => ({
    id,
    sectionId,
    order: 0,
    text,
    pageStart: 1,
    kind: 'body' as const,
    textHash: 'sha256:0',
  });
  return {
    ...base,
    id: uuid((journal ? 300000 : 400000) + n),
    sections: [
      { id: 'int', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
      { id: 'met', heading: 'Methods', role: 'methods', level: 1, pageStart: 2 },
      { id: 'res', heading: 'Results', role: 'results', level: 1, pageStart: 3 },
    ],
    paragraphs: [
      paragraph('i1', 'int', intro),
      paragraph('m1', 'met', `The method is tested on a toy task with ${filler(8)}.`),
      paragraph('r1', 'res', `The results are synthetic and show a toy effect ${filler(6 + (n % 4))}.`),
    ],
  };
}

function syntheticCorpus(journal: boolean, papers: Map<string, ProfilePaper>, size: number): Corpus {
  const corpus = newCorpus({
    id: journal ? 'example-journal' : 'example-control',
    kind: journal ? 'journal' : 'control',
    title: journal ? 'Synthetic journal' : 'Synthetic control',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          venues: [{ name: journal ? 'Synthetic Journal' : 'Synthetic Control', issn: [] }],
          years: [2024, 2025],
          articleTypes: ['research-article'],
          versionOfRecordOnly: true,
          samplingRule: 'synthetic',
          seed: 'example',
          strata: ['year'],
          capPerIssue: null,
          exclusions: [],
        },
      },
    ],
  });
  for (let i = 0; i < size; i++) {
    const memberId = uuid((journal ? 100000 : 200000) + i);
    const member: CorpusMember = {
      memberId,
      identifiers: { sha256: [], paperIds: [], libraryIds: [] },
      exportId: exportIdOf(memberId),
      // One in seven held out, as the sampling's 20 % would be at this size.
      role: i % 7 === 6 ? 'held_out' : 'build',
      stratum: { year: 2024 + (i % 2) },
      version: 'publishedVersion',
      retrieval: 'retrieved',
      textRead: 'FULL_TEXT',
      authorIds: [],
      countries: [],
      decisions: [],
      appraisal: [],
      inputs: null,
    };
    corpus.members.push(member);
    const paper = syntheticPaper(i, journal);
    papers.set(memberId, {
      model: buildPaperModel({ paper, metadata: null, now: new Date(at) }),
      insights: null,
      stance: null,
    });
  }
  corpus.releases.push({
    id: journal ? 'example-journal-r1' : 'example-control-r1',
    createdAt: at,
    protocolVersion: 1,
    digest: `sha256:${'0'.repeat(64)}`,
    memberCount: corpus.members.length,
    registryVersion: String(FEATURE_REGISTRY.version),
  });
  return corpus;
}

/** Synthetic corpora, members and papers behind the example profile. */
export function exampleProfileInputs(size = 7) {
  const papers = new Map<string, ProfilePaper>();
  const target = syntheticCorpus(true, papers, size),
    control = syntheticCorpus(false, papers, size);
  return { target, control, papers };
}

export async function exampleCorpusProfile() {
  return buildCorpusProfile({
    ...exampleProfileInputs(),
    seed: 42,
    now: new Date('2026-11-12T00:00:00.000Z'),
  });
}
