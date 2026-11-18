import { z } from 'zod';
import { SIGNATURE_SECTIONS } from '../corpusProfile/registry';

/** Largest request body POST /v1/measure accepts (UTF-8 bytes of the JSON). */
export const DRAFT_MAX_BYTES = 200 * 1024;

export const DraftInputSchema = z.strictObject({
  format: z.enum(['markdown', 'text']),
  text: z.string().refine((text) => text.trim().length > 0, 'text is empty'),
  title: z.string().max(500).optional(),
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

/**
 * `needs_llm_pass`: the feature counts machine labels (claims, Toulmin elements, stance and rhetoric labels).
 * `grammar_service_unavailable`: passive voice and tense need the spaCy parse, which was not run or failed.
 * `no_data`: measured, but the draft gives no value (the role is absent or the share has no denominator).
 */
export const UNAVAILABLE_REASONS = ['needs_llm_pass', 'grammar_service_unavailable', 'no_data'] as const;

export const DraftFeatureSchema = z.discriminatedUnion('status', [
  z.strictObject({ id: z.string(), value: z.number(), status: z.literal('measured') }),
  z.strictObject({
    id: z.string(),
    value: z.null(),
    status: z.literal('unavailable'),
    reason: z.enum(UNAVAILABLE_REASONS),
  }),
]);

export const DraftSectionSchema = z.strictObject({
  /** Order of the section in the draft, from 0. */
  index: z.number().int().nonnegative(),
  /** 1-based line of the heading in the submitted text; null for text before the first heading. */
  line: z.number().int().positive().nullable(),
  /** The heading line(s) exactly as written (trimmed), with any `#` or numbering; null before the first heading. */
  heading: z.string().nullable(),
  /** The heading as PaperLab reads it: markers and numbering removed. */
  title: z.string(),
  level: z.number().int().positive(),
  /** Signature section role, as in registry v2 feature ids (`section.<ROLE>.*`). */
  role: z.enum(SIGNATURE_SECTIONS),
  /**
   * True when the section's own body paragraphs enter the measures; false for front matter, references, boilerplate
   * and a heading with no text of its own.
   */
  counted: z.boolean(),
  /** Body paragraphs (lists, captions, equations and tables are not body). */
  paragraphs: z.number().int().nonnegative(),
  words: z.number().int().nonnegative(),
});

export const DRAFT_WARNING_CODES = [
  'no_headings',
  'text_before_first_heading',
  'title_heading_lifted',
  'unrecognised_headings',
  'excluded_sections',
  'non_body_blocks',
  'grammar_partial',
  'grammar_service_failed',
] as const;

export const DraftWarningSchema = z.strictObject({
  code: z.enum(DRAFT_WARNING_CODES),
  message: z.string(),
  /** `sections[].index` of the sections the warning is about, when it is about sections. */
  sections: z.array(z.number().int().nonnegative()).optional(),
});

export const DraftMeasureSchema = z.strictObject({
  format: z.literal('paperlab-draft-measure'),
  version: z.literal(1),
  registryId: z.literal('paperlab-feature-registry'),
  registryVersion: z.literal(2),
  /** Same digest as `registry.digest` of a corpus profile v2 built from this registry. */
  registryDigest: z.string(),
  title: z.string().nullable(),
  /** One entry per registry v2 feature, in registry order. */
  features: z.array(DraftFeatureSchema),
  sections: z.array(DraftSectionSchema),
  /** The spaCy parse behind the passive and tense features. */
  grammar: z.strictObject({
    status: z.enum(['parsed', 'not_configured', 'failed']),
    /** `<service version>+spacy-<version> <model>-<version>` when parsed. */
    parser: z.string().nullable(),
    sentences: z.number().int().nonnegative(),
    parsed: z.number().int().nonnegative(),
  }),
  warnings: z.array(DraftWarningSchema),
});
export type DraftMeasure = z.infer<typeof DraftMeasureSchema>;
export type DraftFeature = z.infer<typeof DraftFeatureSchema>;
export type DraftSection = z.infer<typeof DraftSectionSchema>;
export type DraftWarning = z.infer<typeof DraftWarningSchema>;
