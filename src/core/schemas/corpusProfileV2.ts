import { z } from 'zod';
import { SIGNATURE_SECTIONS } from '../corpusProfile/registry';
import { CorpusProfileFeatureSchema, CorpusProfileSchema } from './corpusProfile';

const share = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const role = z.enum(SIGNATURE_SECTIONS);
const status = z.enum(['exploratory', 'supported', 'inconclusive']);

export const CorpusProfileV2FeatureSchema = CorpusProfileFeatureSchema.extend({
  granularity: z.enum(['paper', 'section']),
  section: z.union([role, z.literal('ARTICLE')]),
  /** `tool`: measured by an external parser (spaCy passive voice and tense, P6). */
  extractor: z.enum(['deterministic', 'llm', 'tool']),
  fdrFamily: z.string().min(1).describe('Predeclared FDR testing family, including any core family.'),
  status,
});

/** DRAFT: this shape may change until the contract leaves draft. Built by `buildCorpusProfileV2` (P2). */
export const CorpusProfileV2Schema = CorpusProfileSchema.extend({
  schemaVersion: z.literal(2),
  draft: z.literal(true).describe('DRAFT: the shape may change until the contract leaves draft.'),
  scope: z.enum(['admired', 'signature']),
  sample: z.object({
    n: count,
    rankingRule: z.string(),
    yearBuckets: z.array(z.object({ from: z.number().int(), to: z.number().int(), papers: count })),
    controlRule: z.string(),
  }),
  features: z.array(CorpusProfileV2FeatureSchema),
  headings: z.array(
    z.object({ role, items: z.array(z.object({ heading: z.string(), documentShare: share })) }),
  ),
  sectionSequences: z.array(z.object({ roles: z.array(role), documentShare: share })),
  keywords: z.array(
    z.object({
      /** The OpenAlex keyword id as PaperLab stores it (`PaperKeywordSchema`). */
      id: z.string().regex(/^keywords\/[a-z0-9][a-z0-9-]*$/u),
      name: z.string(),
      targetShare: share,
      controlShare: share,
      g2: z.number().nonnegative(),
      logRatio: z.number(),
    }),
  ),
  classification: z.object({
    subfields: z.array(
      z.object({
        id: z.string().regex(/^subfields\/[0-9]+$/u),
        /** Null when no library record of a member names the subfield (members carry only the id). */
        name: z.string().nullable(),
        targetShare: share,
        controlShare: share,
      }),
    ),
  }),
  evidenceLevel: z
    .object({
      target: z.record(z.enum(['E0', 'E1', 'E2', 'E3', 'E4', 'E5']), share),
      control: z.record(z.enum(['E0', 'E1', 'E2', 'E3', 'E4', 'E5']), share),
    })
    .describe(
      'P7: shares of evidence levels E0–E5 over the main claims of profiled papers (machine labels, live arguments of the latest argument run). Omitted when either side has no graded main claim.',
    )
    .optional(),
});

export type CorpusProfileV2 = z.infer<typeof CorpusProfileV2Schema>;
